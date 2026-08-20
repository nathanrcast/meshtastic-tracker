import json
import math
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from src.models import Geofence, Message, Node, NodePosition, Reaction, Traceroute
from src.config import MAX_TRAIL_POSITIONS, STALE_MINUTES

_geofence_state: dict[tuple[str, int], bool] = {}
_geofence_lock = threading.Lock()


def upsert_node(db: Session, node_id: str, commit: bool = True, **kwargs) -> Node:
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node:
        for k, v in kwargs.items():
            if v is not None:
                setattr(node, k, v)
    else:
        node = Node(node_id=node_id, **{k: v for k, v in kwargs.items() if v is not None})
        db.add(node)
    if commit:
        db.commit()
    return node


def update_node_position(db: Session, node_id: str, lat: float, lon: float, altitude: int | None = None, hops_away: int | None = None):
    now = datetime.now(timezone.utc)
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node:
        node.lat = lat
        node.lon = lon
        node.altitude = altitude
        node.last_heard = now
        node.is_online = 1
        if hops_away is not None:
            node.hops_away = hops_away
    pos = NodePosition(node_id=node_id, lat=lat, lon=lon, altitude=altitude, timestamp=now)
    db.add(pos)
    db.commit()


def add_message(db: Session, from_id: str, to_id: str, channel: int, text: str, snr: float | None = None, rssi: int | None = None, packet_id: int | None = None, hops: int | None = None) -> Message:
    msg = Message(
        from_id=from_id,
        to_id=to_id,
        channel=channel,
        text=text,
        snr=snr,
        rssi=rssi,
        hops=hops,
        packet_id=packet_id,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()
    return msg


def add_reaction(db: Session, message_packet_id: int, from_id: str, emoji: str) -> Reaction:
    reaction = Reaction(
        message_packet_id=message_packet_id,
        from_id=from_id,
        emoji=emoji,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(reaction)
    db.commit()
    return reaction


def get_reactions_by_packet_ids(db: Session, packet_ids: list[int]) -> dict[int, list[dict]]:
    if not packet_ids:
        return {}
    reactions = db.query(Reaction).filter(Reaction.message_packet_id.in_(packet_ids)).all()
    grouped: dict[int, list[dict]] = {}
    for r in reactions:
        grouped.setdefault(r.message_packet_id, []).append({
            "from_id": r.from_id,
            "emoji": r.emoji,
        })
    return grouped


def _serialize_node(n: Node) -> dict:
    return {
        "node_id": n.node_id,
        "long_name": n.long_name,
        "short_name": n.short_name,
        "hardware_model": n.hardware_model,
        "battery_level": n.battery_level,
        "voltage": n.voltage,
        "snr": n.snr,
        "lat": n.lat,
        "lon": n.lon,
        "altitude": n.altitude,
        "hops_away": n.hops_away,
        "last_heard": n.last_heard.isoformat() if n.last_heard else None,
        "is_online": bool(n.is_online),
        "is_tracked": bool(n.is_tracked),
    }


def list_nodes(db: Session, tracked_only: bool = False) -> list[dict]:
    mark_stale_nodes(db)
    query = db.query(Node)
    if tracked_only:
        query = query.filter(Node.is_tracked == 1)
    nodes = query.order_by(Node.is_online.desc(), Node.last_heard.desc()).all()
    return [_serialize_node(n) for n in nodes]


def get_node(db: Session, node_id: str) -> dict | None:
    mark_stale_nodes(db)
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if not node:
        return None
    return _serialize_node(node)


def set_node_tracked(db: Session, node_id: str, tracked: bool) -> Node | None:
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if not node:
        return None
    node.is_tracked = 1 if tracked else 0
    db.commit()
    return node


def get_node_positions(db: Session, node_id: str, hours: int = 24, start: datetime | None = None, end: datetime | None = None) -> list[dict]:
    safe_hours = max(1, min(int(hours or 24), MAX_TRAIL_POSITIONS // 2))  # rough safety
    query = db.query(NodePosition).filter(NodePosition.node_id == node_id)
    if start is not None:
        query = query.filter(NodePosition.timestamp >= start)
        if end is not None:
            query = query.filter(NodePosition.timestamp <= end)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=safe_hours)
        query = query.filter(NodePosition.timestamp >= cutoff)
    positions = query.order_by(NodePosition.timestamp.asc()).limit(MAX_TRAIL_POSITIONS).all()
    return [
        {
            "lat": p.lat,
            "lon": p.lon,
            "altitude": p.altitude,
            "timestamp": p.timestamp.isoformat(),
        }
        for p in positions
    ]


def _load_node_name_map(db: Session, node_ids: list[str]) -> dict[str, str]:
    """Batch load long_name for a set of node_ids in a single query."""
    if not node_ids:
        return {}
    nodes = db.query(Node.node_id, Node.long_name).filter(Node.node_id.in_(node_ids)).all()
    return {nid: (name or "") for nid, name in nodes}


def _serialize_message(m: Message, node_name_map: dict[str, str], reactions_map: dict[int, list[dict]]) -> dict:
    return {
        "id": m.id,
        "from_id": m.from_id,
        "from_name": node_name_map.get(m.from_id) or None,
        "to_id": m.to_id,
        "channel": m.channel,
        "text": m.text,
        "packet_id": m.packet_id,
        "snr": m.snr,
        "rssi": m.rssi,
        "hops": m.hops,
        "timestamp": m.timestamp.isoformat(),
        "reactions": reactions_map.get(m.packet_id, []) if m.packet_id else [],
    }


def list_messages(db: Session, channel: int = 0, limit: int = 100) -> list[dict]:
    safe_limit = max(1, min(int(limit or 100), 500))
    msgs = (
        db.query(Message)
        .filter(Message.channel == channel)
        .order_by(Message.timestamp.desc())
        .limit(safe_limit)
        .all()
    )
    packet_ids = [m.packet_id for m in msgs if m.packet_id is not None]
    reactions_map = get_reactions_by_packet_ids(db, packet_ids)
    from_ids = list({m.from_id for m in msgs})
    node_name_map = _load_node_name_map(db, from_ids)
    # Return in chronological order (oldest first) like before
    return [_serialize_message(m, node_name_map, reactions_map) for m in reversed(msgs)]


def list_dm_messages(db: Session, my_node_id: str, peer_node_id: str, limit: int = 100) -> list[dict]:
    from sqlalchemy import or_, and_

    safe_limit = max(1, min(int(limit or 100), 500))
    msgs = (
        db.query(Message)
        .filter(
            or_(
                and_(Message.from_id == my_node_id, Message.to_id == peer_node_id),
                and_(Message.from_id == peer_node_id, Message.to_id == my_node_id),
            )
        )
        .order_by(Message.timestamp.desc())
        .limit(safe_limit)
        .all()
    )
    packet_ids = [m.packet_id for m in msgs if m.packet_id is not None]
    reactions_map = get_reactions_by_packet_ids(db, packet_ids)
    from_ids = list({m.from_id for m in msgs})
    node_name_map = _load_node_name_map(db, from_ids)
    return [_serialize_message(m, node_name_map, reactions_map) for m in reversed(msgs)]


def list_conversations(db: Session, my_node_id: str) -> list[dict]:
    from sqlalchemy import or_, and_

    msgs = (
        db.query(Message)
        .filter(
            Message.to_id != "^all",
            Message.to_id != "",
            or_(Message.from_id == my_node_id, Message.to_id == my_node_id),
        )
        .order_by(Message.timestamp.desc())
        .all()
    )
    # Collect peer ids and batch load names
    peer_ids = []
    for m in msgs:
        peer = m.to_id if m.from_id == my_node_id else m.from_id
        if peer not in peer_ids:
            peer_ids.append(peer)
    name_map = _load_node_name_map(db, peer_ids)

    seen: dict[str, dict] = {}
    for m in msgs:
        peer_id = m.to_id if m.from_id == my_node_id else m.from_id
        if peer_id not in seen:
            seen[peer_id] = {
                "peer_id": peer_id,
                "peer_name": name_map.get(peer_id) or None,
                "last_message": m.text,
                "last_timestamp": m.timestamp.isoformat(),
            }
    return list(seen.values())


def get_stats(db: Session) -> dict:
    node_count = db.query(Node).count()
    online_count = db.query(Node).filter(Node.is_online == 1).count()
    message_count = db.query(Message).count()
    return {
        "node_count": node_count,
        "online_count": online_count,
        "message_count": message_count,
    }


def mark_stale_nodes(db: Session):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_MINUTES)
    db.query(Node).filter(Node.last_heard < cutoff, Node.is_online == 1).update({"is_online": 0})
    db.commit()


def prune_old_positions(db: Session, days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    count = db.query(NodePosition).filter(NodePosition.timestamp < cutoff).delete()
    db.commit()
    return count


def prune_old_messages(db: Session, days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    msg_count = db.query(Message).filter(Message.timestamp < cutoff).delete()
    rxn_count = db.query(Reaction).filter(Reaction.timestamp < cutoff).delete()
    db.commit()
    return msg_count + rxn_count


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def list_geofences(db: Session) -> list[dict]:
    fences = db.query(Geofence).all()
    return [
        {"id": f.id, "name": f.name, "lat": f.lat, "lon": f.lon, "radius_m": f.radius_m, "enabled": bool(f.enabled)}
        for f in fences
    ]


def create_geofence(db: Session, name: str, lat: float, lon: float, radius_m: int) -> dict:
    fence = Geofence(name=name, lat=lat, lon=lon, radius_m=radius_m)
    db.add(fence)
    db.commit()
    return {"id": fence.id, "name": fence.name, "lat": fence.lat, "lon": fence.lon, "radius_m": fence.radius_m, "enabled": True}


def update_geofence(db: Session, fence_id: int, **kwargs) -> dict | None:
    fence = db.query(Geofence).filter(Geofence.id == fence_id).first()
    if not fence:
        return None
    for k, v in kwargs.items():
        if v is not None:
            setattr(fence, k, 1 if k == "enabled" and v else 0 if k == "enabled" else v)
    db.commit()
    return {"id": fence.id, "name": fence.name, "lat": fence.lat, "lon": fence.lon, "radius_m": fence.radius_m, "enabled": bool(fence.enabled)}


def delete_geofence(db: Session, fence_id: int) -> bool:
    fence = db.query(Geofence).filter(Geofence.id == fence_id).first()
    if not fence:
        return False
    db.delete(fence)
    db.commit()
    with _geofence_lock:
        for k in [k for k in _geofence_state if k[1] == fence_id]:
            del _geofence_state[k]
    return True


def check_geofences(db: Session, node_id: str, lat: float, lon: float) -> list[dict]:
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if not node or not node.is_tracked:
        return []
    fences = db.query(Geofence).filter(Geofence.enabled == 1).all()
    exits = []
    for fence in fences:
        dist = haversine_m(lat, lon, fence.lat, fence.lon)
        is_inside = dist <= fence.radius_m
        key = (node_id, fence.id)
        with _geofence_lock:
            was_inside = _geofence_state.get(key, True)
            _geofence_state[key] = is_inside
        if was_inside and not is_inside:
            exits.append({
                "fence_id": fence.id,
                "fence_name": fence.name,
                "distance_m": round(dist),
                "node_name": node.long_name or node.short_name or node_id,
            })
    return exits


def save_traceroute(db: Session, node_id: str, route: list[dict], route_back: list[dict]) -> dict:
    tr = db.query(Traceroute).filter(Traceroute.node_id == node_id).first()
    now = datetime.now(timezone.utc)
    route_json = json.dumps(route)
    route_back_json = json.dumps(route_back)
    if tr:
        tr.route = route_json
        tr.route_back = route_back_json
        tr.timestamp = now
    else:
        tr = Traceroute(node_id=node_id, route=route_json, route_back=route_back_json, timestamp=now)
        db.add(tr)
    db.commit()
    return {"node_id": node_id, "route": route, "route_back": route_back, "timestamp": now.isoformat()}


def get_traceroute(db: Session, node_id: str) -> dict | None:
    tr = db.query(Traceroute).filter(Traceroute.node_id == node_id).first()
    if not tr:
        return None
    return {
        "node_id": tr.node_id,
        "route": json.loads(tr.route) if tr.route else [],
        "route_back": json.loads(tr.route_back) if tr.route_back else [],
        "timestamp": tr.timestamp.isoformat() if tr.timestamp else None,
    }
