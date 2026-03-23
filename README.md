# Meshtastic Web

A self-hosted web dashboard for monitoring Meshtastic LoRa mesh networks. Always-on TCP gateway with persistent position history, movement trails, multi-channel messaging, and geofence alerts.

## How is this different from the official Meshtastic web client?

The [official client](https://client.meshtastic.org) connects directly from your browser to a radio — it's a device configuration tool. If the browser tab closes, everything stops.

This project runs a **persistent backend** that connects to your radio over TCP and stores everything in a database. It works whether or not anyone has a browser open.

| | Official Client | This Project |
|---|---|---|
| Connection | Browser → Radio (BLE/Serial/HTTP) | Server → Radio (TCP), always-on |
| Data persistence | Browser only (lost on refresh) | SQLite (survives restarts) |
| Position history | None | Days/weeks of stored positions with trails |
| Geofence alerts | Not possible (no backend) | Webhook notifications when nodes leave an area |
| Multi-client | One browser = one connection | Any number of browsers via WebSocket |
| Device config | Full settings UI (channels, LoRa, modules) | Not supported — use the official client for that |

**Use the official client for one-time device setup. Use this project for ongoing monitoring.**

## Features

- **Real-time map** with node markers, movement trail polylines, and geofence circles (Leaflet + CartoDB)
- **Multi-channel messaging** with send/receive across primary and secondary channels
- **Node tracking** — star devices to filter the map to "My Nodes" with per-node visibility toggles
- **Position history** — SQLite stores days/weeks of positions, configurable auto-pruning
- **Geofence alerts** — define geographic boundaries, get webhook notifications when tracked nodes leave
- **Per-node color coding** — deterministic hash-based palette, consistent across map, trails, and messages
- **Dual theme** — dark hacker (cyan) and light corporate (blue), persisted per-browser
- **API key auth** — optional shared key protects all endpoints (opt-in via env var)
- **Health API** — `/api/health` endpoint for external monitoring (e.g., n8n, Uptime Kuma)
- **WebSocket broadcasting** — real-time position, message, and geofence events to all connected clients
- **Stale node detection** — automatic offline marking after configurable timeout

## Architecture

```
Meshtastic Radio (TCP mode, e.g. Heltec V3)
    |  TCP :4403
FastAPI + meshtastic-python (always-on gateway)
    |  SQLite (nodes, positions, messages, geofences)
    |  REST API + WebSocket
React SPA (Vite + Tailwind + Leaflet)
```

## Quick Start

```bash
git clone https://github.com/nathanrcast/meshtastic-web.git
cd meshtastic-web
cp .env.example .env
# Edit .env — set MESHTASTIC_HOST to your device's IP
docker compose up -d --build
```

Open `http://<your-host>:8200` in a browser.

## Prerequisites

- Docker and Docker Compose
- A Meshtastic device with TCP server enabled and WiFi connected to your LAN
  - In the Meshtastic app: **Settings > Network > WiFi** (connect to your LAN). TCP server is enabled by default when WiFi is connected.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MESHTASTIC_HOST` | *(required)* | IP address of the Meshtastic TCP device |
| `MESHTASTIC_PORT` | `4403` | TCP port on the device |
| `RECONNECT_INTERVAL` | `15` | Seconds between reconnect attempts |
| `STALE_MINUTES` | `15` | Minutes before a node is marked offline |
| `DATABASE_URL` | `sqlite:///data/meshtastic.db` | SQLAlchemy database URL |
| `API_KEY` | *(empty — auth disabled)* | Shared API key. If set, all endpoints except `/api/health` require `X-API-Key` header |
| `PRUNE_DAYS` | `30` | Auto-delete position records older than this many days (runs on startup) |
| `GEOFENCE_WEBHOOK_URL` | *(empty — disabled)* | URL to POST a JSON payload when a tracked node exits a geofence |

### Geofence Webhook Payload

When a tracked node leaves an enabled geofence, the server POSTs:

```json
{
  "event": "geofence_exit",
  "node_id": "!abc12345",
  "node_name": "Device Name",
  "fence_name": "Home",
  "distance_m": 1523
}
```

## Device Setup Guide

### Base Station (TCP Gateway)

The base station stays at home, connected to your LAN, and acts as the TCP gateway.

1. Flash Meshtastic firmware via the [web flasher](https://flasher.meshtastic.org/)
2. Pair via the Meshtastic Android/iOS app over Bluetooth
3. Configure WiFi: **Settings > Network > WiFi** > enter SSID and password
4. Assign a static IP or DHCP reservation on your router
5. Set `MESHTASTIC_HOST` in `.env` to this IP

### Channel Setup (Private Precise Location)

Meshtastic only broadcasts position on the **primary channel** (index 0). To keep precise location private, make your private channel primary and move the default public channel to secondary.

On the base station (via the Meshtastic app):

1. **Settings > Channels** > edit the primary channel (index 0)
2. Rename it to your private channel name (e.g., "Family")
3. Generate a new PSK (pre-shared key) — save this for other devices
4. Set position precision to **32** (full precision)
5. Add the default public channel (e.g., LongFast) as a **secondary channel**

> **Why this matters:** Position broadcasts always go to the primary channel. If your private channel is secondary, your nodes won't broadcast position on it. Swapping the channel order is the only reliable way to get precise location on a private channel.

### Additional Devices

Each device that should appear on the map:

1. Install the [Meshtastic app](https://meshtastic.org/downloads/) and pair via Bluetooth
2. Set the **primary channel** (index 0) to the same name and PSK from above
3. Set position precision to **32** on the primary channel
4. Add any public channels as secondary
5. Ensure GPS is enabled: **Settings > Position > GPS Enabled**
6. For stationary devices without GPS, set a fixed position: **Settings > Position > Fixed Position**

### Using the Web App

1. Open the web app and go to the **Nodes** page
2. Star each device you want to track (click the star icon)
3. On the **Map** page, "My Nodes" shows only starred devices with colored markers and trails
4. Use the message panel to send and receive on any channel
5. Open the **Geofences** panel to define alert boundaries

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/nodes` | List all nodes (`?tracked=true` for starred only) |
| `PATCH` | `/api/nodes/{id}/tracked` | Star/unstar a node |
| `GET` | `/api/nodes/{id}/positions` | Position history (`?hours=24`) |
| `GET` | `/api/channels` | Active channels from device |
| `GET` | `/api/messages` | Messages (`?channel=0&limit=100`) |
| `POST` | `/api/messages` | Send a message (`{"text": "...", "channel": 0}`) |
| `GET` | `/api/geofences` | List all geofences |
| `POST` | `/api/geofences` | Create a geofence |
| `PATCH` | `/api/geofences/{id}` | Update a geofence |
| `DELETE` | `/api/geofences/{id}` | Delete a geofence |
| `GET` | `/api/health` | Health check (always open, no auth required) |
| `WS` | `/api/ws` | Real-time events (position, message, node_update, geofence_exit) |

## License

[MIT](LICENSE)
