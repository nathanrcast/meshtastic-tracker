from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from src.db import Base


class Node(Base):
    __tablename__ = "nodes"

    node_id = Column(String(20), primary_key=True)
    long_name = Column(String(100), default="")
    short_name = Column(String(10), default="")
    hardware_model = Column(String(50), default="")
    battery_level = Column(Integer, nullable=True)
    voltage = Column(Float, nullable=True)
    snr = Column(Float, nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    altitude = Column(Integer, nullable=True)
    last_heard = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_online = Column(Integer, default=1)
    is_tracked = Column(Integer, default=0)

    positions = relationship("NodePosition", back_populates="node", cascade="all, delete-orphan")


class NodePosition(Base):
    __tablename__ = "node_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(String(20), ForeignKey("nodes.node_id"), nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    altitude = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    node = relationship("Node", back_populates="positions")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_id = Column(String(20), nullable=False)
    to_id = Column(String(20), default="")
    channel = Column(Integer, default=0)
    text = Column(Text, default="")
    snr = Column(Float, nullable=True)
    rssi = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
