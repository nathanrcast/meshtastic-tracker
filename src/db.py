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

        if "hops" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN hops INTEGER"))
            conn.commit()
            log.info("Added hops column to messages table")

        if "packet_id" not in msg_cols:
            conn.execute(text("ALTER TABLE messages ADD COLUMN packet_id INTEGER"))
            conn.commit()
            log.info("Added packet_id column to messages table")

        tables = [r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))]
        if "reactions" not in tables:
            conn.execute(text("""
                CREATE TABLE reactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_packet_id INTEGER NOT NULL,
                    from_id VARCHAR(20) NOT NULL,
                    emoji VARCHAR(16) NOT NULL,
                    timestamp DATETIME
                )
            """))
            conn.commit()
            log.info("Created reactions table")

        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_position_node_timestamp ON node_positions (node_id, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_channel_timestamp ON messages (channel, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_from_id ON messages (from_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_packet_id ON messages (packet_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reaction_message_packet_id ON reactions (message_packet_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_to_id ON messages (to_id)"))
        conn.commit()
        log.info("Ensured indexes exist")
    log.info("Database initialized")
