# Meshtastic Tracker — agent notes

Self-hosted dashboard for a Meshtastic LoRa mesh: an always-on TCP gateway (`src/mesh.py`) that persists positions, trails, messages and geofence alerts to SQLite, with a FastAPI backend (`src/api.py`) and a React + Vite SPA (`web/`). Architecture: `docs/architecture.md`. **Public repo** — lab details go in the gitignored `CLAUDE.local.md`.

## Commands

- Gate (no test suite): `python3 -m compileall -q src && cd web && npm run build` (`vite build` → `web/dist/`).
- `docker compose up -d --build` — full stack.

## Invariants

- **Mesh callbacks fire on worker threads** (pubsub's publishing thread or a threadpool), never the event loop. Hop back with `loop.call_soon_threadsafe()` before touching asyncio objects — see the WebSocket fan-out in `src/api.py` (`_put` + `call_soon_threadsafe`). Keep it correct here — it is copied into other code.
- SQLite runs in WAL mode with `busy_timeout` set (`src/db.py`) — keep the DB on local disk, never a network mount.
- Migrations are lightweight PRAGMA introspection + additive `ALTER TABLE` after `create_all` in `src/db.py` — no Alembic.
- UI uses the shared `th-*` theme tokens (Hacker/Corporate, cyan/blue accent).

## Traps

- A `node_modules` or `.venv` created from another OS on a shared mount fails here (`.bin/vite: XSym: not found`, missing `@rollup/rollup-linux-x64-gnu`). Fix by reinstalling in place (`rm -rf node_modules && npm install`; regenerate `package-lock.json` only if its platform binaries are wrong), not by debugging npm.

## Review focus

- Asyncio objects touched from mesh callback threads.
- Unbounded queues or history queries on the hot paths (position history grows forever).
