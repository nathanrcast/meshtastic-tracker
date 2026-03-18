# Meshtastic Web

LoRa mesh network visualizer and family GPS tracker. Real-time map, multi-channel messaging, and node tracking via a Meshtastic TCP gateway.

## Features

- Real-time map with node positions and movement trails (Leaflet + CartoDB tiles)
- Multi-channel messaging (primary + private secondary channels)
- Node tracking — star family devices to filter the map to "My Nodes"
- Live updates via WebSocket (position, messages, node info)
- Position history with configurable trail duration

## Architecture

```
Meshtastic Device (Heltec V3, TCP mode)
    ↓ TCP :4403
FastAPI backend (meshtastic-python)
    ↓ REST + WebSocket
React SPA (Vite + Tailwind + Leaflet)
```

- **Backend:** FastAPI + SQLite, connects to a Meshtastic device over TCP, caches nodes/messages/positions
- **Frontend:** React SPA with dark theme (zinc + indigo), served as static files by the backend

## Prerequisites

- Docker and Docker Compose
- A Meshtastic device with TCP server enabled (e.g., Heltec V3)
  - In the Meshtastic app: Settings → Network → WiFi (connect to your LAN) → Enable TCP Server

## Deployment

```bash
cp .env.example .env
# Edit .env — set MESHTASTIC_HOST to your device's IP
docker compose up -d --build
```

The app is available at `http://<host>:8200`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MESHTASTIC_HOST` | *(required)* | IP address of the Meshtastic TCP device |
| `MESHTASTIC_PORT` | `4403` | TCP port on the Meshtastic device |
| `RECONNECT_INTERVAL` | `15` | Seconds between reconnect attempts |
| `STALE_MINUTES` | `15` | Minutes before a node is marked offline |
| `DATABASE_URL` | `sqlite:///data/meshtastic.db` | SQLAlchemy database URL |

## Family GPS Tracker Setup

This app was built to track family members' Meshtastic devices on a private map. Here's how to set it up.

### 1. Base Station (Heltec V3)

The base station stays at home, connected to your LAN, and acts as the TCP gateway for the web app.

1. Flash Meshtastic firmware via the [web flasher](https://flasher.meshtastic.org/)
2. Connect via the Meshtastic Android/iOS app over Bluetooth
3. Configure WiFi: Settings → Network → WiFi → enter SSID and password
4. Enable TCP server (enabled by default when WiFi is connected)
5. Assign a static IP or DHCP reservation on your router
6. Set `MESHTASTIC_HOST` in `.env` to this IP

### 2. Secondary Private Channel (Family GPS)

Create a private channel for precise family GPS that isn't broadcast on the public mesh.

On the base station (via the Meshtastic app):

1. Go to Settings → Channels
2. Tap **+** to add a new channel
3. Name it (e.g., "Family")
4. Generate a new PSK (pre-shared key) — save this for the child devices
5. Set position precision to **32** (full precision) on this channel

### 3. Child Devices (Family Members)

Each family member carries a Meshtastic device (e.g., Heltec V3, T-Beam, RAK).

1. Install the [Meshtastic app](https://meshtastic.org/downloads/) and pair via Bluetooth
2. Go to Settings → Channels → **+** to add the same secondary channel
3. Enter the exact same channel name and PSK from step 2
4. On the channel settings, set position precision to **32**
5. Ensure GPS is enabled: Settings → Position → GPS Enabled

The child device will now broadcast its precise location on the private channel, picked up by the base station and shown on the web map.

### 4. Web App — Track Family Devices

1. Open the web app and go to the **Nodes** page
2. Star each family member's device (click the star icon)
3. On the **Map** page, the "My Nodes" filter shows only starred devices
4. Switch to the family channel in the message panel to send private messages
