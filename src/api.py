import asyncio
import logging
import os

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from src.db import SessionLocal, init_db
from src.mesh import MeshtasticManager
from src.queries import get_node_positions, get_stats, list_messages, list_nodes, set_node_tracked
from src.schemas import SendMessage, TrackNodeRequest

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("meshtastic-web")

app = FastAPI(title="Meshtastic Web")
mesh = MeshtasticManager()


# -- Security headers --

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    csp = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https://*.basemaps.cartocdn.com https://unpkg.com data:; "
        "connect-src 'self' ws: wss:"
    )
    response.headers["Content-Security-Policy"] = csp
    return response


# -- Startup / Shutdown --

@app.on_event("startup")
def on_startup():
    init_db()
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
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Node not found")
        return {"ok": True, "node_id": node_id, "is_tracked": body.is_tracked}
    finally:
        db.close()


@app.get("/api/nodes/{node_id}/positions")
def api_node_positions(node_id: str, hours: int = Query(default=24, ge=1, le=168)):
    db = SessionLocal()
    try:
        return get_node_positions(db, node_id, hours)
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
def api_send_message(body: SendMessage):
    try:
        result = mesh.send_text(body.text, body.channel)
        return result
    except RuntimeError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/disconnect")
def api_disconnect():
    mesh.disconnect()
    return {"ok": True}


@app.post("/api/reconnect")
def api_reconnect():
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
    }


# -- WebSocket --

@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
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
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid path")
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
