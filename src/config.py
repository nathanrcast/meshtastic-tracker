import logging
import os

from dotenv import load_dotenv

load_dotenv()

# Mesh connection
MESHTASTIC_HOST = os.getenv("MESHTASTIC_HOST", "")
MESHTASTIC_PORT = int(os.getenv("MESHTASTIC_PORT", "4403"))
RECONNECT_INTERVAL = int(os.getenv("RECONNECT_INTERVAL", "15"))

# Node tracking
STALE_MINUTES = int(os.getenv("STALE_MINUTES", "15"))

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/meshtastic.db")

# Auth (shared key, opt-in)
API_KEY = os.getenv("API_KEY", "")

# Data retention
PRUNE_DAYS = int(os.getenv("PRUNE_DAYS", "30"))

# Geofence alerts
GEOFENCE_WEBHOOK_URL = os.getenv("GEOFENCE_WEBHOOK_URL", "")
# Comma-separated list of allowed hostnames for webhook (e.g. "alerts.example.com,webhook.internal")
GEOFENCE_WEBHOOK_ALLOWED_HOSTS = [
    h.strip() for h in os.getenv("GEOFENCE_WEBHOOK_ALLOWED_HOSTS", "").split(",") if h.strip()
]

# Rate limiting
RATE_LIMIT = int(os.getenv("RATE_LIMIT", "20"))
RATE_WINDOW_SECONDS = int(os.getenv("RATE_WINDOW_SECONDS", "60"))
RATE_BUCKET_MAX = int(os.getenv("RATE_BUCKET_MAX", "100"))  # cap per-IP history to bound memory

# API / pagination safety caps
MAX_MESSAGES_LIMIT = int(os.getenv("MAX_MESSAGES_LIMIT", "500"))
MAX_POSITIONS_HOURS = int(os.getenv("MAX_POSITIONS_HOURS", "720"))
MAX_TRAIL_POSITIONS = int(os.getenv("MAX_TRAIL_POSITIONS", "2000"))  # server-side cap on positions returned for trails

# WebSocket
WS_QUEUE_MAXSIZE = int(os.getenv("WS_QUEUE_MAXSIZE", "100"))

# CORS: comma-separated origins, empty means no CORS middleware (same-origin assumed)
CORS_ALLOW_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()
]

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# Basemap
BASEMAP_MODE = os.getenv("BASEMAP_MODE", "openfreemap").strip().lower()
if BASEMAP_MODE not in ("openfreemap", "pmtiles"):
    logging.getLogger("meshtastic-web").warning(
        "BASEMAP_MODE=%r is not a recognized value (expected 'openfreemap' or 'pmtiles') "
        "— falling back to 'openfreemap'", BASEMAP_MODE
    )
    BASEMAP_MODE = "openfreemap"
BASEMAP_PMTILES_DIR = os.getenv("BASEMAP_PMTILES_DIR", "/app/tiles")
BASEMAP_PMTILES_FILE = os.getenv("BASEMAP_PMTILES_FILE", "basemap.pmtiles")

# Map default view (used until node data arrives and the map fits to it, or a
# saved view is restored from the browser's localStorage)
def _parse_latlon(raw, default):
    try:
        lat_s, lon_s = raw.split(",")
        return [float(lat_s), float(lon_s)]
    except (ValueError, AttributeError):
        return default

MAP_DEFAULT_CENTER = _parse_latlon(os.getenv("MAP_DEFAULT_CENTER", "0,0"), [0.0, 0.0])
MAP_DEFAULT_ZOOM = int(os.getenv("MAP_DEFAULT_ZOOM", "2"))
