# Architecture

Internal architecture, library quirks, and gotchas for the meshtastic-tracker service. Lifted from `HomeNetwork/skills/meshtastic.md` 2026-05-21 — that file is the wrong home (project-internal detail, not cross-cutting domain knowledge).

## Stack

- Python FastAPI + SQLite + React/Vite/Tailwind SPA, WebSocket for real-time.
- Deploy: push to GitHub → `git pull` on Ubuntu .11 → `docker compose up -d --build`.
- Deploy folder on .11: `~/docker/meshtastic-web/` (legacy name — repo is source of truth).
- Runs at `meshtastic.int.anathemasit.com` (.11:8200).

## Hardware

- **Gateway:** Heltec V3 (ESP32-S3 + SX1262 LoRa) connected via TCP.
- Single TCP slot — only one client (web app OR phone app) at a time. Web app has disconnect/reconnect button to release the slot.
- Config: `MESHTASTIC_HOST` / `MESHTASTIC_PORT` env vars in docker-compose.

## Backend layout

- `src/mesh.py` — `MeshtasticManager`: TCP connection, pubsub event handlers, reconnect loop, WS broadcast.
- `src/api.py` — FastAPI app: REST endpoints + WebSocket + SPA fallback.
- `src/models.py` — SQLAlchemy: Node, NodePosition, Message (SQLite).
- `src/queries.py` — All DB read/write operations.
- `src/db.py` — Engine, session, migrations (ALTER TABLE pattern for new columns).
- `src/config.py` — Env-based config.
- `src/schemas.py` — Pydantic request models (`SendMessage` has optional `to_id` for DMs).

## Meshtastic Python library

- `meshtastic.tcp_interface.TCPInterface` for connection.
- `pubsub` events: `meshtastic.receive.position`, `meshtastic.receive.text`, `meshtastic.receive.nodeinfo`, `meshtastic.connection.lost`.
- `iface.myInfo.my_node_num` → hex node ID `!xxxxxxxx`.
- `iface.nodes` dict on connect seeds the DB.
- `iface.localNode.channels` — channel list with role (PRIMARY/SECONDARY/DISABLED), name, PSK.
- `iface.sendText(text, channelIndex=N)` to broadcast, `iface.sendText(text, destinationId=nodeId, channelIndex=N)` for DM.

## Packet structure

- `packet["fromId"]` / `packet["toId"]` — node IDs like `!aabbccdd`.
- `packet["channel"]` — channel index (0 = primary).
- `packet["decoded"]["text"]` — message text.
- `packet["decoded"]["position"]` — lat/lon/altitude.
- `packet["decoded"]["user"]` — longName/shortName/hwModel.
- `packet["rxSnr"]` / `packet["rxRssi"]` — RF signal data (only on received packets).
- `packet["decoded"]["portnum"]` — identifies packet type.

## Channels

- Channels configured on device, not in web app.
- PSK must match between all devices on a channel.
- `uplink`/`downlink` settings are MQTT-only — irrelevant for TCP connections.
- Web app reads channels from device on connect, caches them.
- Multi-channel messaging: channel selector in `MessagePanel`, messages filtered by channel index.
- **Firmware change (2026):** Each channel broadcasts position independently with its own precision setting — don't make private channels primary (broadcasts at full GPS precision on all channels).

## Direct messages

- Backend: `POST /api/messages` with `to_id` field, `GET /api/messages/dm/{peer_id}`, `GET /api/conversations`.
- Mesh: `sendText(text, destinationId=to_id, channelIndex=0)` — DMs default to channel 0.
- Frontend: DM tabs (violet) in `MessagePanel`, clickable sender names, "Message" button in map popups, inline thread on the node details page.
- Node list: clicking a node row navigates to `/nodes/{node_id}` (the details page); its inline thread is the primary DM entry point. "Open in Map ↗" on that page still opens the classic `/?dm=nodeId` tab.
- State persisted: `openDMs`, `activeConversation` via `usePersistedState`.
- WebSocket routes DMs by inspecting `to_id` field (not `^all`).

## Node details page

- Route: `/nodes/:nodeId` (`web/src/pages/NodeDetail.jsx`). Reached from the Nodes table row, or "Details" in a map marker popup (`Map.jsx`'s `onOpenDetails` prop, threaded from `MapView.jsx`).
- Backend: `GET /api/nodes/{node_id}` (404 if unknown) avoids fetching the full 1000+ row list for a single-node view.
- Layout: mini `Map` (single node + its trail, no geofences), telemetry panel, inline DM thread (not the `MessagePanel` component — that's hard-coded to the map's collapsible sidebar), traceroute panel.
- Trail: same hour-preset buttons as the map, refetched via `api.nodePositions` on preset change; live WS `position` events for this node are appended client-side between refetches.

## Traceroute

- Backend: `MeshtasticManager.send_traceroute()` fires `sendData(RouteDiscovery(), portNum=TRACEROUTE_APP, wantResponse=True)` directly — **not** `iface.sendTraceRoute()`, which blocks synchronously and only prints to stdout.
- Reply arrives on the `meshtastic.receive.traceroute` pubsub topic (`protocols[70].name == "traceroute"`), handled by `MeshtasticManager._on_traceroute`.
- `RouteDiscovery.route`/`routeBack` are node numbers (uint32) — format as `!{num:08x}`. SNR values are ints scaled ×4 (`-128` = unknown, divide the rest by 4).
- `snrTowards` has one more entry than `route` — the extra entry is the SNR of the final hop into the traced node, keyed by `packet["from"]`. Symmetrically, a valid `routeBack` requires `hopStart` present on the packet and `len(snrBack) == len(routeBack) + 1`, with the final entry keyed by `packet["to"]` (us).
- Persisted one row per node (`Traceroute` model, upserted) via `save_traceroute`/`get_traceroute` in `queries.py`. `GET /api/nodes/{node_id}/traceroute` returns the last stored result; `POST` fires a new one and returns immediately — the result arrives over the WebSocket as a `traceroute` event, not in the POST response.
- No failure event exists on the wire — the firmware simply doesn't reply if the node is unreachable. The frontend times out client-side after 30s.

## Key patterns

- DB migrations: `init_db()` checks `PRAGMA table_info`, `ALTER`s if column missing (no Alembic).
- WebSocket: `on_event` callback runs on a mesh callback thread (pubsub's `publishingThread`, or a request threadpool worker), never the event loop thread — it hops onto the loop via `loop.call_soon_threadsafe()` before touching the `asyncio.Queue`. Writing to the queue directly from a callback thread is not safe.
- Reconnect loop: daemon thread, checks `_connected` and `_auto_reconnect` every N seconds.
- Node staleness: `mark_stale_nodes()` sets `is_online=0` after configurable timeout.
- Frontend sorts nodes client-side (sortable table headers), backend returns default sort.
- `hops_away`: sourced from `NodeInfo.hops_away` on seed (has explicit protobuf presence — `0` means direct neighbour, absent means unknown) and re-derived per-packet as `hopStart - hopLimit` on position/text/nodeinfo packets (`_hops_from_packet` in `mesh.py`). Two different quantities sharing one column: the seeded value is the mesh's own hop count, the packet-derived value is per-transmission.

## Frontend

- React Router: `/` (Map), `/nodes` (Nodes table), `/nodes/:nodeId` (node details).
- Map: Leaflet with CartoDB dark tiles, tracked vs all node filtering, position persisted to localStorage.
- `MessagePanel`: collapsible side panel on Map page, multi-channel tabs, DM tabs (violet).
- Direct messaging: click a node row to open its details page (inline DM thread), or "Message" in a map popup to open the map's DM tab directly.
- `usePersistedState` hook: drop-in `useState` replacement backed by localStorage, handles Sets via JSON array serialization.
- Layout: responsive sidebar nav (desktop, `sticky top-0 h-screen` so the theme toggle / connect-disconnect / stats stay visible under a tall page like the 1000+ row Nodes table) / hamburger menu (mobile), health polling.
- Design: dual-theme (hacker/corporate), `th-*` CSS tokens, cyan accent (hacker) / blue (corporate). Cross-project token system documented in `HomeNetwork/skills/ui-design.md`.
- `useWebSocket` hook: auto-reconnect WS, dispatches events to pages. Cleanup sets a `cancelled` flag checked in `onclose` before it schedules a reconnect — without it, unmounting mid-backoff still reconnects (every Map↔Nodes navigation would otherwise leak one live socket).
- `utc()` helper: normalizes ISO timestamps missing `Z` suffix.

## Gotchas

1. Heltec single TCP slot — disconnect from web before using phone app.
2. `rxSnr`/`rxRssi` only present on received packets, not outgoing — always nullable.
3. Node IDs are hex strings prefixed with `!` (e.g., `!aabbccdd`).
4. Position can come as `latitude`/`longitude` (float) OR `latitudeI`/`longitudeI` (int, divide by `1e7`).
5. Channel index 0 is always primary, secondary channels start at 1.
6. SQLite `check_same_thread=False` required for multi-thread access.
