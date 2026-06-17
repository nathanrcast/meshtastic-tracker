import asyncio
import hmac
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from src.config import (
    API_KEY,
    CORS_ALLOW_ORIGINS,
    LOG_LEVEL,
    MAX_MESSAGES_LIMIT,
    MAX_POSITIONS_HOURS,
    PRUNE_DAYS,
    RATE_BUCKET_MAX,
    RATE_LIMIT,
    RATE_WINDOW_SECONDS,
    WS_QUEUE_MAXSIZE,
)
from src.db import SessionLocal, get_db, init_db
from src.mesh import MeshtasticManager
from src.queries import (
    create_geofence,
    delete_geofence,
    get_node_positions,
    get_stats,
    list_conversations,
    list_dm_messages,
    list_geofences,
    list_messages,
    list_nodes,
    prune_old_messages,
    prune_old_positions,
    set_node_tracked,
    update_geofence,
)
from src.schemas import CreateGeofence, SendMessage, SendReaction, TrackNodeRequest, UpdateGeofence

logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
log = logging.getLogger("meshtastic-web")

mesh = MeshtasticManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
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
    yield
    # Shutdown
    mesh.stop()


app = FastAPI(title="Meshtastic Web", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

# -- CORS (only if explicitly configured; default is no CORS = same-origin) --
if CORS_ALLOW_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOW_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )


# -- Rate limiting (in-memory, bounded) --

_rate_buckets: dict[str, list[float]] = defaultdict(list)
_last_rate_cleanup = 0.0


def _cleanup_rate_buckets(now: float):
    """Drop old entries and bound per-IP history to avoid unbounded growth."""
    global _last_rate_cleanup
    if now - _last_rate_cleanup < 30:
        return
    _last_rate_cleanup = now
    to_delete = []
    for ip, times in _rate_buckets.items():
        fresh = [t for t in times if now - t < RATE_WINDOW_SECONDS]
        if fresh:
            # keep only the most recent RATE_BUCKET_MAX
            _rate_buckets[ip] = fresh[-RATE_BUCKET_MAX:]
        else:
            to_delete.append(ip)
    for ip in to_delete:
        del _rate_buckets[ip]


def _check_rate_limit(client_ip: str) -> bool:
    now = time.monotonic()
    _cleanup_rate_buckets(now)
    bucket = _rate_buckets[client_ip]
    bucket[:] = [t for t in bucket if now - t < RATE_WINDOW_SECONDS]
    if len(bucket) >= RATE_LIMIT:
        return False
    bucket.append(now)
    # bound the list
    if len(bucket) > RATE_BUCKET_MAX:
        del bucket[0 : len(bucket) - RATE_BUCKET_MAX]
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
    # NOTE: 'unsafe-inline' for styles is required by current Tailwind build.
    # We removed the open unpkg.com CDN. Only allow known tile hosts.
    csp = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https://*.basemaps.cartocdn.com data:; "
        "connect-src 'self' ws: wss:; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
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


# Note: startup/shutdown logic moved to lifespan above.


# -- Dependency for DB sessions in endpoints --

def _get_db_dep():
    # FastAPI dependency wrapper (no auto-commit; queries manage their own commits)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -- REST endpoints --

@app.get("/api/nodes")
def api_nodes(tracked: bool = Query(default=False), db=Depends(_get_db_dep)):
    return list_nodes(db, tracked_only=tracked)


@app.patch("/api/nodes/{node_id}/tracked")
def api_track_node(node_id: str, body: TrackNodeRequest, db=Depends(_get_db_dep)):
    node = set_node_tracked(db, node_id, body.is_tracked)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return {"ok": True, "node_id": node_id, "is_tracked": body.is_tracked}


@app.get("/api/nodes/{node_id}/positions")
def api_node_positions(
    node_id: str,
    hours: int = Query(default=24, ge=1, le=MAX_POSITIONS_HOURS),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    db=Depends(_get_db_dep),
):
    from datetime import datetime as dt, timezone as tz

    start_dt = dt.fromisoformat(start).replace(tzinfo=tz.utc) if start else None
    end_dt = dt.fromisoformat(end).replace(tzinfo=tz.utc) if end else None
    return get_node_positions(db, node_id, hours, start=start_dt, end=end_dt)


@app.get("/api/channels")
def api_channels():
    return mesh.get_channels()


@app.get("/api/messages")
def api_messages(
    channel: int = Query(default=0, ge=0, le=255),
    limit: int = Query(default=100, ge=1, le=MAX_MESSAGES_LIMIT),
    db=Depends(_get_db_dep),
):
    return list_messages(db, channel, limit)


@app.post("/api/messages")
def api_send_message(body: SendMessage, request: Request):
    try:
        result = mesh.send_text(body.text, body.channel, to_id=body.to_id)
        client = request.client.host if request.client else "unknown"
        if body.to_id:
            log.info("DM sent to=%s ch=%d by %s", body.to_id, body.channel, client)
        else:
            log.info("Message sent ch=%d by %s", body.channel, client)
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


@app.get("/api/messages/dm/{peer_id}")
def api_dm_messages(
    peer_id: str,
    limit: int = Query(default=100, ge=1, le=MAX_MESSAGES_LIMIT),
    db=Depends(_get_db_dep),
):
    my_id = mesh.my_node_id
    if not my_id:
        raise HTTPException(status_code=503, detail="Local node ID not available")
    return list_dm_messages(db, my_id, peer_id, limit)


@app.get("/api/conversations")
def api_conversations(db=Depends(_get_db_dep)):
    my_id = mesh.my_node_id
    if not my_id:
        raise HTTPException(status_code=503, detail="Local node ID not available")
    return list_conversations(db, my_id)


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
def api_health(db=Depends(_get_db_dep)):
    stats = get_stats(db)
    return {
        "connected": mesh.connected,
        "node_count": stats["node_count"],
        "message_count": stats["message_count"],
        "my_node_id": mesh.my_node_id,
        "auth_required": bool(API_KEY),
    }


# -- Geofences --

@app.get("/api/geofences")
def api_geofences(db=Depends(_get_db_dep)):
    return list_geofences(db)


@app.post("/api/geofences")
def api_create_geofence(body: CreateGeofence, request: Request, db=Depends(_get_db_dep)):
    result = create_geofence(db, body.name, body.lat, body.lon, body.radius_m)
    log.info("Geofence created: %s by %s", body.name, request.client.host if request.client else "unknown")
    return result


@app.patch("/api/geofences/{fence_id}")
def api_update_geofence(fence_id: int, body: UpdateGeofence, request: Request, db=Depends(_get_db_dep)):
    result = update_geofence(db, fence_id, **body.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Geofence not found")
    log.info("Geofence updated: id=%d by %s", fence_id, request.client.host if request.client else "unknown")
    return result


@app.delete("/api/geofences/{fence_id}")
def api_delete_geofence(fence_id: int, request: Request, db=Depends(_get_db_dep)):
    if not delete_geofence(db, fence_id):
        raise HTTPException(status_code=404, detail="Geofence not found")
    log.info("Geofence deleted: id=%d by %s", fence_id, request.client.host if request.client else "unknown")
    return {"ok": True}


# -- WebSocket --
# NOTE: API key in query param is convenient for browsers but appears in logs/proxies.
# Prefer cookies or subprotocol auth in high-security deployments.

@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
    if API_KEY:
        key = ws.query_params.get("key", "")
        if not key or not hmac.compare_digest(key, API_KEY):
            await ws.close(code=4001, reason="Invalid API key")
            return
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=WS_QUEUE_MAXSIZE)
    loop = asyncio.get_event_loop()

    dropped = 0

    def on_event(event: dict):
        nonlocal dropped
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            dropped += 1  # best-effort; clients may miss events under heavy load

    mesh.register_ws(on_event)
    try:
        # Periodically surface if we dropped (simple marker)
        while True:
            event = await queue.get()
            if dropped:
                # inject a diagnostic event occasionally
                try:
                    await ws.send_json({"type": "debug", "dropped_events": dropped})
                except Exception:
                    pass
                dropped = 0
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

    def _is_safe_under(base: Path, target: Path) -> bool:
        try:
            target.resolve().relative_to(base.resolve())
            return True
        except Exception:
            return False

    @app.get("/{path:path}")
    def spa_fallback(path: str):
        # Prevent path traversal outside the static dir
        candidate = (STATIC_DIR / path).resolve()
        if not _is_safe_under(STATIC_DIR, candidate):
            raise HTTPException(status_code=400, detail="Invalid path")
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
