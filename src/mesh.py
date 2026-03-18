import logging
import threading
import time
from datetime import datetime, timezone

from src.config import MESHTASTIC_HOST, MESHTASTIC_PORT, RECONNECT_INTERVAL
from src.db import SessionLocal
from src.queries import add_message, update_node_position, upsert_node

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
            finally:
                db.close()

            self._broadcast({
                "type": "position",
                "node_id": from_id,
                "lat": lat,
                "lon": lon,
                "altitude": alt,
            })
        except Exception:
            log.exception("Error handling position packet")

    def _on_text(self, packet, interface):
        try:
            from_id = packet.get("fromId", "")
            to_id = packet.get("toId", "")
            channel = packet.get("channel", 0)
            text = packet.get("decoded", {}).get("text", "")

            if not text:
                return

            from src.models import Node

            db = SessionLocal()
            try:
                msg = add_message(db, from_id, to_id, channel, text)
                node = db.query(Node).filter_by(node_id=from_id).first()
                from_name = node.long_name if node else None
            finally:
                db.close()

            self._broadcast({
                "type": "message",
                "id": msg.id,
                "from_id": from_id,
                "from_name": from_name,
                "to_id": to_id,
                "channel": channel,
                "text": text,
                "timestamp": msg.timestamp.isoformat(),
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

    def _on_disconnect(self, interface):
        log.warning("Lost connection to Meshtastic")
        self._connected = False
        self._interface = None

    def send_text(self, text: str, channel: int = 0):
        if not self._interface or not self._connected:
            raise RuntimeError("Not connected to Meshtastic")
        self._interface.sendText(text, channelIndex=channel)
        if self._my_node_id:
            db = SessionLocal()
            try:
                msg = add_message(db, self._my_node_id, "^all", channel, text)
            finally:
                db.close()
            self._broadcast({
                "type": "message",
                "id": msg.id,
                "from_id": self._my_node_id,
                "from_name": "Base Station",
                "to_id": "^all",
                "channel": channel,
                "text": text,
                "timestamp": msg.timestamp.isoformat(),
            })

    def _reconnect_loop(self):
        while self._running:
            if not self._connected:
                self._connect()
            time.sleep(RECONNECT_INTERVAL)

    def start(self):
        if self._running:
            return
        self._running = True
        self._connect()
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
