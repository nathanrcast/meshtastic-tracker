import asyncio
import hmac
import logging
import os
import time
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from src.config import API_KEY, PRUNE_DAYS
from src.db import SessionLocal, init_db
from src.mesh import MeshtasticManager
from src.queries import (
    create_geofence, delete_geofence, get_node_positions, get_stats,
    list_geofences, list_messages, list_nodes, prune_old_messages,
    prune_old_positions, set_node_tracked, update_geofence,
)
from src.schemas import CreateGeofence, SendMessage, SendReaction, TrackNodeRequest, UpdateGeofence

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("meshtastic-web")

app = FastAPI(title="Meshtastic Web", docs_url=None, redoc_url=None, openapi_url=None)
mesh = MeshtasticManager()


# -- Rate limiting --

_rate_buckets: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 20  # requests per window
RATE_WINDOW = 60  # seconds


def _check_rate_limit(client_ip: str) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets[client_ip]
    bucket[:] = [t for t in bucket if now - t < RATE_WINDOW]
    if len(bucket) >= RATE_LIMIT:
        return False
    bucket.append(now)
    return True


# -- Security headers --

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), usb=()"
    csp = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https://*.basemaps.cartocdn.com https://unpkg.com data:; "
        "connect-src 'self' ws: wss:"
    )
    response.headers["Content-Security-Policy"] = csp
    return response


# -- Auth middleware --

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if API_KEY and request.url.path.startswith("/api/") and request.url.path != "/api/health":
        key = request.headers.get("X-API-Key", "") or request.query_params.get("key", "")
        if not key or not hmac.compare_digest(key, API_KEY):
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
    return await call_next(request)


# -- Rate limit on write endpoints --

RATE_LIMITED_PREFIXES = ("/api/messages", "/api/geofences", "/api/disconnect", "/api/reconnect")


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.method in ("POST", "PATCH", "DELETE") and any(
        request.url.path.startswith(p) for p in RATE_LIMITED_PREFIXES
    ):
        client_ip = request.client.host if request.client else "unknown"
        if not _check_rate_limit(client_ip):
            return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})
    return await call_next(request)


# -- Global exception handler --

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# -- Startup / Shutdown --

@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        pos_count = prune_old_positions(db, PRUNE_DAYS)
        msg_count = prune_old_messages(db, PRUNE_DAYS)
        if pos_count:
            log.info("Pruned %d old positions (>%d days)", pos_count, PRUNE_DAYS)
        if msg_count:
            log.info("Pruned %d old messages/reactions (>%d days)", msg_count, PRUNE_DAYS)
    finally:
        db.close()
    mesh.start()


@app.on_event("shutdown")
def on_shutdown():
    mesh.stop()


# -- REST endpoints --

@app.get("/api/nodes")
def api_nodes(tracked: bool = Query(default=False)):
    db = SessionLocal()
    try:
        return list_nodes(db, tracked_only=tracked)
    finally:
        db.close()


@app.patch("/api/nodes/{node_id}/tracked")
def api_track_node(node_id: str, body: TrackNodeRequest):
    db = SessionLocal()
    try:
        node = set_node_tracked(db, node_id, body.is_tracked)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        return {"ok": True, "node_id": node_id, "is_tracked": body.is_tracked}
    finally:
        db.close()


@app.get("/api/nodes/{node_id}/positions")
def api_node_positions(
    node_id: str,
    hours: int = Query(default=24, ge=1, le=720),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
):
    from datetime import datetime as dt, timezone as tz
    start_dt = dt.fromisoformat(start).replace(tzinfo=tz.utc) if start else None
    end_dt = dt.fromisoformat(end).replace(tzinfo=tz.utc) if end else None
    db = SessionLocal()
    try:
        return get_node_positions(db, node_id, hours, start=start_dt, end=end_dt)
    finally:
        db.close()


@app.get("/api/channels")
def api_channels():
    return mesh.get_channels()


@app.get("/api/messages")
def api_messages(channel: int = Query(default=0, ge=0, le=255), limit: int = Query(default=100, ge=1, le=500)):
    db = SessionLocal()
    try:
        return list_messages(db, channel, limit)
    finally:
        db.close()


@app.post("/api/messages")
def api_send_message(body: SendMessage, request: Request):
    try:
        result = mesh.send_text(body.text, body.channel)
        log.info("Message sent ch=%d by %s", body.channel, request.client.host if request.client else "unknown")
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/messages/{packet_id}/react")
def api_react(packet_id: int, body: SendReaction, request: Request):
    try:
        result = mesh.send_reaction(body.emoji, packet_id, body.channel)
        log.info("Reaction %s on pkt=%d by %s", body.emoji, packet_id, request.client.host if request.client else "unknown")
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/disconnect")
def api_disconnect(request: Request):
    log.warning("Mesh disconnect requested by %s", request.client.host if request.client else "unknown")
    mesh.disconnect()
    return {"ok": True}


@app.post("/api/reconnect")
def api_reconnect(request: Request):
    log.info("Mesh reconnect requested by %s", request.client.host if request.client else "unknown")
    mesh.reconnect()
    return {"ok": True}


@app.get("/api/health")
def api_health():
    db = SessionLocal()
    try:
        stats = get_stats(db)
    finally:
        db.close()
    return {
        "connected": mesh.connected,
        "node_count": stats["node_count"],
        "message_count": stats["message_count"],
        "my_node_id": mesh.my_node_id,
        "auth_required": bool(API_KEY),
    }


# -- Geofences --

@app.get("/api/geofences")
def api_geofences():
    db = SessionLocal()
    try:
        return list_geofences(db)
    finally:
        db.close()


@app.post("/api/geofences")
def api_create_geofence(body: CreateGeofence, request: Request):
    db = SessionLocal()
    try:
        result = create_geofence(db, body.name, body.lat, body.lon, body.radius_m)
        log.info("Geofence created: %s by %s", body.name, request.client.host if request.client else "unknown")
        return result
    finally:
        db.close()


@app.patch("/api/geofences/{fence_id}")
def api_update_geofence(fence_id: int, body: UpdateGeofence, request: Request):
    db = SessionLocal()
    try:
        result = update_geofence(db, fence_id, **body.model_dump(exclude_none=True))
        if not result:
            raise HTTPException(status_code=404, detail="Geofence not found")
        log.info("Geofence updated: id=%d by %s", fence_id, request.client.host if request.client else "unknown")
        return result
    finally:
        db.close()


@app.delete("/api/geofences/{fence_id}")
def api_delete_geofence(fence_id: int, request: Request):
    db = SessionLocal()
    try:
        if not delete_geofence(db, fence_id):
            raise HTTPException(status_code=404, detail="Geofence not found")
        log.info("Geofence deleted: id=%d by %s", fence_id, request.client.host if request.client else "unknown")
        return {"ok": True}
    finally:
        db.close()


# -- WebSocket --

@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
    if API_KEY:
        key = ws.query_params.get("key", "")
        if not key or not hmac.compare_digest(key, API_KEY):
            await ws.close(code=4001, reason="Invalid API key")
            return
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    loop = asyncio.get_event_loop()

    def on_event(event: dict):
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except asyncio.QueueFull:
            pass

    mesh.register_ws(on_event)
    try:
        while True:
            event = await queue.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("WebSocket error")
    finally:
        mesh.unregister_ws(on_event)


# -- SPA fallback --

STATIC_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="static")

    @app.get("/{path:path}")
    def spa_fallback(path: str):
        file_path = (STATIC_DIR / path).resolve()
        if not (file_path == STATIC_DIR or str(file_path).startswith(str(STATIC_DIR) + os.sep)):
            raise HTTPException(status_code=400, detail="Invalid path")
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
