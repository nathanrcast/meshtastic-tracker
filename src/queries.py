import math
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from src.models import Geofence, Message, Node, NodePosition, Reaction
from src.config import STALE_MINUTES

_geofence_state: dict[tuple[str, int], bool] = {}


def upsert_node(db: Session, node_id: str, **kwargs) -> Node:
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node:
        for k, v in kwargs.items():
            if v is not None:
                setattr(node, k, v)
    else:
        node = Node(node_id=node_id, **{k: v for k, v in kwargs.items() if v is not None})
        db.add(node)
    db.commit()
    return node


def update_node_position(db: Session, node_id: str, lat: float, lon: float, altitude: int | None = None):
    now = datetime.now(timezone.utc)
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node:
        node.lat = lat
        node.lon = lon
        node.altitude = altitude
        node.last_heard = now
        node.is_online = 1
    pos = NodePosition(node_id=node_id, lat=lat, lon=lon, altitude=altitude, timestamp=now)
    db.add(pos)
    db.commit()


def add_message(db: Session, from_id: str, to_id: str, channel: int, text: str, snr: float | None = None, rssi: int | None = None, packet_id: int | None = None) -> Message:
    msg = Message(
        from_id=from_id,
        to_id=to_id,
        channel=channel,
        text=text,
        snr=snr,
        rssi=rssi,
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


def list_nodes(db: Session, tracked_only: bool = False) -> list[dict]:
    mark_stale_nodes(db)
    query = db.query(Node)
    if tracked_only:
        query = query.filter(Node.is_tracked == 1)
    nodes = query.order_by(Node.is_online.desc(), Node.last_heard.desc()).all()
    return [
        {
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
            "last_heard": n.last_heard.isoformat() if n.last_heard else None,
            "is_online": bool(n.is_online),
            "is_tracked": bool(n.is_tracked),
        }
        for n in nodes
    ]


def set_node_tracked(db: Session, node_id: str, tracked: bool) -> Node | None:
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if not node:
        return None
    node.is_tracked = 1 if tracked else 0
    db.commit()
    return node


def get_node_positions(db: Session, node_id: str, hours: int = 24) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    positions = (
        db.query(NodePosition)
        .filter(NodePosition.node_id == node_id, NodePosition.timestamp >= cutoff)
        .order_by(NodePosition.timestamp.asc())
        .all()
    )
    return [
        {
            "lat": p.lat,
            "lon": p.lon,
            "altitude": p.altitude,
            "timestamp": p.timestamp.isoformat(),
        }
        for p in positions
    ]


def list_messages(db: Session, channel: int = 0, limit: int = 100) -> list[dict]:
    msgs = (
        db.query(Message)
        .filter(Message.channel == channel)
        .order_by(Message.timestamp.desc())
        .limit(limit)
        .all()
    )
    packet_ids = [m.packet_id for m in msgs if m.packet_id is not None]
    reactions_map = get_reactions_by_packet_ids(db, packet_ids)
    node_cache: dict[str, str] = {}
    result = []
    for m in reversed(msgs):
        if m.from_id not in node_cache:
            node = db.query(Node).filter(Node.node_id == m.from_id).first()
            node_cache[m.from_id] = node.long_name if node else ""
        result.append({
            "id": m.id,
            "from_id": m.from_id,
            "from_name": node_cache[m.from_id] or None,
            "to_id": m.to_id,
            "channel": m.channel,
            "text": m.text,
            "packet_id": m.packet_id,
            "snr": m.snr,
            "rssi": m.rssi,
            "timestamp": m.timestamp.isoformat(),
            "reactions": reactions_map.get(m.packet_id, []) if m.packet_id else [],
        })
    return result


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
