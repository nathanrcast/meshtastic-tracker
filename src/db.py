import logging
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from src.config import DATABASE_URL, MAX_POSITIONS_HOURS

log = logging.getLogger("meshtastic-web.db")


class Base(DeclarativeBase):
    pass


# For SQLite, allow cross-thread usage (FastAPI + background mesh thread)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


# --- SQLite performance & safety pragmas (applied per connection) ---
@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        # WAL for better concurrency and crash safety
        cursor.execute("PRAGMA journal_mode=WAL")
        # Balance safety vs speed; NORMAL is recommended with WAL
        cursor.execute("PRAGMA synchronous=NORMAL")
        # Larger cache (negative = KB)
        cursor.execute("PRAGMA cache_size=-20000")
        # Store temp tables in memory
        cursor.execute("PRAGMA temp_store=MEMORY")
        # Reasonable timeout for contended writes
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


@contextmanager
def get_db():
    """Context manager for DB sessions. Use in non-FastAPI code paths."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        # --- lightweight migrations via PRAGMA introspection ---
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(nodes)"))]
        if "is_tracked" not in cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN is_tracked INTEGER DEFAULT 0"))
            conn.commit()
            log.info("Added is_tracked column to nodes table")

        if "hops_away" not in cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN hops_away INTEGER"))
            conn.commit()
            log.info("Added hops_away column to nodes table")

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
            conn.execute(
                text(
                    """
                CREATE TABLE reactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_packet_id INTEGER NOT NULL,
                    from_id VARCHAR(20) NOT NULL,
                    emoji VARCHAR(16) NOT NULL,
                    timestamp DATETIME
                )
            """
                )
            )
            conn.commit()
            log.info("Created reactions table")

        if "traceroutes" not in tables:
            conn.execute(
                text(
                    """
                CREATE TABLE traceroutes (
                    node_id VARCHAR(20) PRIMARY KEY,
                    route TEXT DEFAULT '',
                    route_back TEXT DEFAULT '',
                    timestamp DATETIME
                )
            """
                )
            )
            conn.commit()
            log.info("Created traceroutes table")

        # Indexes (idempotent)
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_position_node_timestamp ON node_positions (node_id, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_channel_timestamp ON messages (channel, timestamp)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_from_id ON messages (from_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_packet_id ON messages (packet_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reaction_message_packet_id ON reactions (message_packet_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_message_to_id ON messages (to_id)"))
        conn.commit()
        log.info("Ensured indexes exist")

    # Enforce a sane max for any callers that might pass huge hour windows
    if MAX_POSITIONS_HOURS < 1:
        log.warning("MAX_POSITIONS_HOURS is set too low; using 720")
    log.info("Database initialized (WAL=%s)", "yes" if DATABASE_URL.startswith("sqlite") else "n/a")
