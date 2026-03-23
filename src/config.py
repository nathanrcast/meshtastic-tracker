import os

from dotenv import load_dotenv

load_dotenv()

MESHTASTIC_HOST = os.getenv("MESHTASTIC_HOST", "")
MESHTASTIC_PORT = int(os.getenv("MESHTASTIC_PORT", "4403"))
RECONNECT_INTERVAL = int(os.getenv("RECONNECT_INTERVAL", "15"))
STALE_MINUTES = int(os.getenv("STALE_MINUTES", "15"))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/meshtastic.db")
API_KEY = os.getenv("API_KEY", "")
PRUNE_DAYS = int(os.getenv("PRUNE_DAYS", "30"))
GEOFENCE_WEBHOOK_URL = os.getenv("GEOFENCE_WEBHOOK_URL", "")
