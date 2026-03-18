from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from src.models import Message, Node, NodePosition
from src.config import STALE_MINUTES


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


def add_message(db: Session, from_id: str, to_id: str, channel: int, text: str) -> Message:
    msg = Message(
        from_id=from_id,
        to_id=to_id,
        channel=channel,
        text=text,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()
    return msg


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
            "timestamp": m.timestamp.isoformat(),
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
