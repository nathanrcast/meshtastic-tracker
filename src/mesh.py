import logging
import threading
import time
from datetime import datetime, timezone

from src.config import GEOFENCE_WEBHOOK_URL, MESHTASTIC_HOST, MESHTASTIC_PORT, RECONNECT_INTERVAL
from src.db import SessionLocal
from src.queries import add_message, add_reaction, check_geofences, update_node_position, upsert_node

log = logging.getLogger("meshtastic-web.mesh")


class MeshtasticManager:
    def __init__(self):
        self._interface = None
        self._connected = False
        self._my_node_id: str | None = None
        self._channels: list[dict] = []
        self._ws_callbacks: list = []
        self._lock = threading.Lock()
        self._running = False
        self._auto_reconnect = True

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def my_node_id(self) -> str | None:
        return self._my_node_id

    def register_ws(self, callback):
        with self._lock:
            self._ws_callbacks.append(callback)

    def unregister_ws(self, callback):
        with self._lock:
            self._ws_callbacks = [cb for cb in self._ws_callbacks if cb is not callback]

    def _broadcast(self, event: dict):
        with self._lock:
            callbacks = list(self._ws_callbacks)
        for cb in callbacks:
            try:
                cb(event)
            except Exception:
                log.exception("WS callback error")

    def _connect(self):
        if not MESHTASTIC_HOST:
            log.warning("MESHTASTIC_HOST not set, skipping connection")
            return

        import socket

        try:
            # Pre-check connectivity with a short timeout before attempting TCPInterface
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((MESHTASTIC_HOST, MESHTASTIC_PORT))
            sock.close()
        except (socket.timeout, OSError):
            log.warning("Meshtastic device unreachable at %s:%d", MESHTASTIC_HOST, MESHTASTIC_PORT)
            return

        try:
            from meshtastic.tcp_interface import TCPInterface

            log.info("Connecting to %s:%d", MESHTASTIC_HOST, MESHTASTIC_PORT)
            iface = TCPInterface(hostname=MESHTASTIC_HOST, portNumber=MESHTASTIC_PORT)
            self._interface = iface
            self._connected = True

            my_info = iface.myInfo
            if my_info:
                self._my_node_id = f"!{my_info.my_node_num:08x}"

            self._seed_nodes(iface)
            self._cache_channels(iface)
            self._subscribe(iface)
            log.info("Connected to Meshtastic (my_node=%s, channels=%d)", self._my_node_id, len(self._channels))
        except Exception:
            log.exception("Failed to connect to Meshtastic")
            self._connected = False
            self._interface = None

    def _seed_nodes(self, iface):
        nodes = iface.nodes
        if not nodes:
            return

        db = SessionLocal()
        try:
            for node_id, info in nodes.items():
                user = info.get("user", {})
                pos = info.get("position", {})
                metrics = info.get("deviceMetrics", {})
                upsert_node(
                    db,
                    node_id,
                    long_name=user.get("longName", ""),
                    short_name=user.get("shortName", ""),
                    hardware_model=user.get("hwModel", ""),
                    battery_level=metrics.get("batteryLevel"),
                    voltage=metrics.get("voltage"),
                    snr=info.get("snr"),
                    lat=pos.get("latitude"),
                    lon=pos.get("longitude"),
                    altitude=pos.get("altitude"),
                    last_heard=datetime.fromtimestamp(info["lastHeard"], tz=timezone.utc) if info.get("lastHeard") else None,
                    is_online=1,
                )
            log.info("Seeded %d nodes from mesh", len(nodes))
        finally:
            db.close()

    def _cache_channels(self, iface):
        channels = []
        try:
            for ch in iface.localNode.channels:
                if ch.role == 0:  # DISABLED
                    continue
                name = ch.settings.name or ("Primary" if ch.role == 1 else f"Channel {ch.index}")
                role = "PRIMARY" if ch.role == 1 else "SECONDARY"
                channels.append({"index": ch.index, "name": name, "role": role})
        except Exception:
            log.exception("Failed to read channels from device")
        self._channels = channels

    def get_channels(self) -> list[dict]:
        if self._channels:
            return self._channels
        return [{"index": 0, "name": "Primary", "role": "PRIMARY"}]

    def _subscribe(self, iface):
        from pubsub import pub

        pub.subscribe(self._on_position, "meshtastic.receive.position")
        pub.subscribe(self._on_text, "meshtastic.receive.text")
        pub.subscribe(self._on_nodeinfo, "meshtastic.receive.nodeinfo")
        pub.subscribe(self._on_disconnect, "meshtastic.connection.lost")
        log.info("Subscribed to mesh events")

    def _on_position(self, packet, interface):
        try:
            from_id = packet.get("fromId", "")
            pos = packet.get("decoded", {}).get("position", {})
            lat = pos.get("latitude") or pos.get("latitudeI", 0) / 1e7
            lon = pos.get("longitude") or pos.get("longitudeI", 0) / 1e7
            alt = pos.get("altitude")

            if not lat and not lon:
                return

            db = SessionLocal()
            try:
                update_node_position(db, from_id, lat, lon, alt)
                exits = check_geofences(db, from_id, lat, lon)
            finally:
                db.close()

            self._broadcast({
                "type": "position",
                "node_id": from_id,
                "lat": lat,
                "lon": lon,
                "altitude": alt,
            })

            for exit_info in exits:
                self._broadcast({
                    "type": "geofence_exit",
                    "node_id": from_id,
                    "node_name": exit_info["node_name"],
                    "fence_name": exit_info["fence_name"],
                    "distance_m": exit_info["distance_m"],
                })
                self._fire_geofence_webhook(from_id, exit_info)
        except Exception:
            log.exception("Error handling position packet")

    def _on_text(self, packet, interface):
        try:
            from_id = packet.get("fromId", "")
            to_id = packet.get("toId", "")
            channel = packet.get("channel", 0)
            decoded = packet.get("decoded", {})
            text = decoded.get("text", "")
            snr = packet.get("rxSnr")
            rssi = packet.get("rxRssi")
            pkt_id = packet.get("id")

            if not text:
                return

            is_emoji = decoded.get("emoji")
            reply_id = decoded.get("replyId") or decoded.get("reply_id")

            if is_emoji and reply_id:
                db = SessionLocal()
                try:
                    add_reaction(db, reply_id, from_id, text)
                finally:
                    db.close()

                self._broadcast({
                    "type": "reaction",
                    "message_packet_id": reply_id,
                    "from_id": from_id,
                    "emoji": text,
                })
                return

            from src.models import Node

            db = SessionLocal()
            try:
                msg = add_message(db, from_id, to_id, channel, text, snr=snr, rssi=rssi, packet_id=pkt_id)
                msg_id = msg.id
                msg_ts = msg.timestamp.isoformat()
                node = db.query(Node).filter_by(node_id=from_id).first()
                from_name = node.long_name if node else None
            finally:
                db.close()

            self._broadcast({
                "type": "message",
                "id": msg_id,
                "from_id": from_id,
                "from_name": from_name,
                "to_id": to_id,
                "channel": channel,
                "text": text,
                "packet_id": pkt_id,
                "snr": snr,
                "rssi": rssi,
                "timestamp": msg_ts,
                "reactions": [],
            })
        except Exception:
            log.exception("Error handling text packet")

    def _on_nodeinfo(self, packet, interface):
        try:
            from_id = packet.get("fromId", "")
            user = packet.get("decoded", {}).get("user", {})
            if not user:
                return

            db = SessionLocal()
            try:
                upsert_node(
                    db,
                    from_id,
                    long_name=user.get("longName", ""),
                    short_name=user.get("shortName", ""),
                    hardware_model=user.get("hwModel", ""),
                )
            finally:
                db.close()

            self._broadcast({
                "type": "node_update",
                "node_id": from_id,
                "long_name": user.get("longName", ""),
                "short_name": user.get("shortName", ""),
            })
        except Exception:
            log.exception("Error handling nodeinfo packet")

    def _fire_geofence_webhook(self, node_id: str, exit_info: dict):
        if not GEOFENCE_WEBHOOK_URL:
            return
        if not GEOFENCE_WEBHOOK_URL.startswith(("http://", "https://")):
            log.warning("Ignoring non-HTTP webhook URL")
            return
        import json
        import urllib.request
        payload = json.dumps({
            "event": "geofence_exit",
            "node_id": node_id,
            "node_name": exit_info["node_name"],
            "fence_name": exit_info["fence_name"],
            "distance_m": exit_info["distance_m"],
        }).encode()
        try:
            req = urllib.request.Request(
                GEOFENCE_WEBHOOK_URL,
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
            log.info("Geofence alert: %s exited %s", exit_info["node_name"], exit_info["fence_name"])
        except Exception:
            log.exception("Failed to send geofence webhook")

    def _on_disconnect(self, interface):
        log.warning("Lost connection to Meshtastic")
        self._connected = False
        self._interface = None

    def send_text(self, text: str, channel: int = 0) -> dict:
        if not self._interface or not self._connected:
            raise RuntimeError("Not connected to Meshtastic")
        result = self._interface.sendText(text, channelIndex=channel)
        pkt_id = result.id if result else None
        from_id = self._my_node_id or "local"
        db = SessionLocal()
        try:
            msg = add_message(db, from_id, "^all", channel, text, packet_id=pkt_id)
            msg_id = msg.id
            msg_ts = msg.timestamp.isoformat()
            from src.models import Node
            node = db.query(Node).filter_by(node_id=from_id).first() if self._my_node_id else None
            from_name = node.long_name if node else "Base Station"
        finally:
            db.close()
        event = {
            "type": "message",
            "id": msg_id,
            "from_id": from_id,
            "from_name": from_name,
            "to_id": "^all",
            "channel": channel,
            "text": text,
            "packet_id": pkt_id,
            "snr": None,
            "rssi": None,
            "timestamp": msg_ts,
            "reactions": [],
        }
        self._broadcast(event)
        return event

    def send_reaction(self, emoji: str, reply_to_packet_id: int, channel: int = 0) -> dict:
        if not self._interface or not self._connected:
            raise RuntimeError("Not connected to Meshtastic")

        from meshtastic.protobuf import mesh_pb2, portnums_pb2
        from meshtastic.mesh_interface import BROADCAST_ADDR

        meshPacket = mesh_pb2.MeshPacket()
        meshPacket.channel = channel
        meshPacket.decoded.portnum = portnums_pb2.PortNum.TEXT_MESSAGE_APP
        meshPacket.decoded.payload = emoji.encode("utf-8")
        meshPacket.decoded.emoji = 1
        meshPacket.decoded.reply_id = reply_to_packet_id
        meshPacket.id = self._interface._generatePacketId()

        self._interface._sendPacket(meshPacket, BROADCAST_ADDR)

        from_id = self._my_node_id or "local"
        db = SessionLocal()
        try:
            add_reaction(db, reply_to_packet_id, from_id, emoji)
        finally:
            db.close()

        event = {
            "type": "reaction",
            "message_packet_id": reply_to_packet_id,
            "from_id": from_id,
            "emoji": emoji,
        }
        self._broadcast(event)
        return event

    def disconnect(self):
        self._auto_reconnect = False
        if self._interface:
            try:
                self._interface.close()
            except Exception:
                pass
            self._interface = None
        self._connected = False
        log.info("Manually disconnected from Meshtastic")

    def reconnect(self):
        self._auto_reconnect = True
        if not self._connected:
            self._connect()

    def _reconnect_loop(self):
        while self._running:
            if not self._connected and self._auto_reconnect:
                self._connect()
            time.sleep(RECONNECT_INTERVAL)

    def start(self):
        if self._running:
            return
        self._running = True
        t = threading.Thread(target=self._reconnect_loop, daemon=True)
        t.start()
        log.info("MeshtasticManager started (reconnect_interval=%ds)", RECONNECT_INTERVAL)

    def stop(self):
        self._running = False
        if self._interface:
            try:
                self._interface.close()
            except Exception:
                pass
            self._interface = None
            self._connected = False
