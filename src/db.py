import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from src.config import DATABASE_URL

log = logging.getLogger("meshtastic-web.db")


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(nodes)"))]
        if "is_tracked" not in cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN is_tracked INTEGER DEFAULT 0"))
            conn.commit()
            log.info("Added is_tracked column to nodes table")

        msg_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(messages)"))]
        if "snr" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN snr REAL"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN rssi INTEGER"))
            conn.commit()
            log.info("Added snr/rssi columns to messages table")

        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_position_node_timestamp ON node_positions (node_id, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_channel_timestamp ON messages (channel, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_from_id ON messages (from_id)"))
        conn.commit()
        log.info("Ensured indexes exist")
    log.info("Database initialized")
