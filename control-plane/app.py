"""Control Plane API server — state management for K8s."""
from __future__ import annotations
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .state import SessionStore
from .checkpoint_proxy import CheckpointStore
from .worker_registry import WorkerRegistry
from .audit import AuditLog

logger = logging.getLogger(__name__)

sessions = SessionStore()
checkpoints = CheckpointStore()
registry = WorkerRegistry()
audit = AuditLog()

# SSE subscribers: session_id -> list of asyncio.Queue
import asyncio
sse_queues: dict[str, list[asyncio.Queue]] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Control Plane started")
    yield

app = FastAPI(title="Control Plane", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Sessions ---

class CreateSessionRequest(BaseModel):
    worker_id: str = ""
    goal: str = ""
    workdir: str = "."

class UpdateSessionRequest(BaseModel):
    status: str | None = None
    current_task: str | None = None
    step: int | None = None

@app.post("/sessions")
def create_session(req: CreateSessionRequest):
    session = sessions.create(req.worker_id, req.goal, req.workdir)
    audit.log_event(session["id"], "session.created", {"goal": req.goal})
    return session

@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session

@app.patch("/sessions/{session_id}")
def update_session(session_id: str, req: UpdateSessionRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        session = sessions.update(session_id, updates)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not session:
        raise HTTPException(404, "Session not found")
    audit.log_event(session_id, "session.updated", updates)
    # Push SSE event
    _push_sse(session_id, {"type": "session.updated", "data": session})
    return session

@app.get("/sessions")
def list_sessions(status: str | None = None):
    return sessions.list_all(status)

# --- Checkpoints ---

class PutCheckpointRequest(BaseModel):
    checkpoint: dict
    metadata: dict = {}

@app.get("/checkpoints/{thread_id}")
def get_checkpoint(thread_id: str):
    cp = checkpoints.get_latest(thread_id)
    if not cp:
        raise HTTPException(404, "No checkpoint found")
    return cp

@app.put("/checkpoints/{thread_id}")
def put_checkpoint(thread_id: str, req: PutCheckpointRequest):
    return checkpoints.put(thread_id, req.checkpoint, req.metadata)

@app.get("/checkpoints/{thread_id}/history")
def checkpoint_history(thread_id: str, limit: int = 10):
    return checkpoints.get_history(thread_id, limit)

# --- Interrupts ---
interrupts: dict[str, dict] = {}
interrupt_futures: dict[str, asyncio.Future] = {}

class CreateInterruptRequest(BaseModel):
    session_id: str
    value: str

class ResolveInterruptRequest(BaseModel):
    resume_value: str

@app.post("/interrupts")
async def create_interrupt(req: CreateInterruptRequest):
    from uuid import uuid4
    from datetime import datetime, timezone
    interrupt_id = str(uuid4())
    interrupts[interrupt_id] = {
        "id": interrupt_id,
        "session_id": req.session_id,
        "value": req.value,
        "status": "pending",
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    future = asyncio.get_event_loop().create_future()
    interrupt_futures[interrupt_id] = future
    audit.log_event(req.session_id, "interrupt.created", {"interrupt_id": interrupt_id, "value": req.value})
    _push_sse(req.session_id, {"type": "interrupt.created", "data": interrupts[interrupt_id]})
    return interrupts[interrupt_id]

@app.get("/interrupts/{interrupt_id}")
def get_interrupt(interrupt_id: str):
    if interrupt_id not in interrupts:
        raise HTTPException(404, "Interrupt not found")
    return interrupts[interrupt_id]

@app.post("/interrupts/{interrupt_id}/resolve")
async def resolve_interrupt(interrupt_id: str, req: ResolveInterruptRequest):
    if interrupt_id not in interrupts:
        raise HTTPException(404, "Interrupt not found")
    interrupts[interrupt_id]["status"] = "resolved"
    interrupts[interrupt_id]["resume_value"] = req.resume_value
    future = interrupt_futures.pop(interrupt_id, None)
    if future and not future.done():
        future.set_result(req.resume_value)
    session_id = interrupts[interrupt_id]["session_id"]
    audit.log_event(session_id, "interrupt.resolved", {"interrupt_id": interrupt_id})
    _push_sse(session_id, {"type": "interrupt.resolved", "data": interrupts[interrupt_id]})
    return interrupts[interrupt_id]

@app.get("/interrupts")
def list_interrupts(session_id: str | None = None, status: str | None = None):
    result = list(interrupts.values())
    if session_id:
        result = [i for i in result if i["session_id"] == session_id]
    if status:
        result = [i for i in result if i["status"] == status]
    return result

# --- Workers ---

@app.get("/workers")
def list_workers():
    return registry.list_all()

@app.websocket("/ws/worker")
async def worker_ws(ws: WebSocket):
    await ws.accept()
    worker_id = None
    try:
        raw = await ws.receive_text()
        msg = json.loads(raw)
        if msg.get("type") != "register":
            await ws.close(4001, "Expected register")
            return
        worker_id = msg.get("worker_id", "unknown")
        registry.register(worker_id, ws, msg.get("capabilities", []), msg.get("workdir", "."))

        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg["type"] == "heartbeat":
                registry.heartbeat(worker_id)
            elif msg["type"] == "state_update":
                session_id = msg.get("session_id", "")
                sessions.update(session_id, {
                    "status": msg.get("status", "RUNNING"),
                    "current_task": msg.get("current_task"),
                    "step": msg.get("step", 0),
                })
                _push_sse(session_id, {"type": "state_update", "data": msg})
            elif msg["type"] == "stream":
                session_id = msg.get("session_id", "")
                _push_sse(session_id, msg)
            elif msg["type"] == "artifact":
                session_id = msg.get("session_id", "")
                audit.record_artifact(session_id, msg.get("artifact_type", "FILE"), msg.get("path", ""), msg.get("content", ""))
    except WebSocketDisconnect:
        pass
    finally:
        if worker_id:
            registry.unregister(worker_id)

# --- SSE Events ---

@app.get("/events/{session_id}")
async def sse_events(session_id: str):
    """Server-Sent Events stream for a session."""
    queue: asyncio.Queue = asyncio.Queue()
    if session_id not in sse_queues:
        sse_queues[session_id] = []
    sse_queues[session_id].append(queue)

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_queues[session_id].remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

def _push_sse(session_id: str, event: dict):
    for q in sse_queues.get(session_id, []):
        q.put_nowait(event)

# --- Artifacts ---

class RecordArtifactRequest(BaseModel):
    session_id: str
    type: str
    path: str
    content: str = ""

@app.post("/artifacts")
def record_artifact(req: RecordArtifactRequest):
    return audit.record_artifact(req.session_id, req.type, req.path, req.content)

@app.get("/artifacts")
def list_artifacts(session_id: str | None = None):
    return audit.get_artifacts(session_id)

# --- Audit ---

@app.get("/audit")
def list_audit_events(session_id: str | None = None, limit: int = 100):
    return audit.get_events(session_id, limit)

# --- Health ---

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "control-plane",
        "sessions": len(sessions.sessions),
        "workers": len(registry.workers),
        "checkpoints": sum(len(v) for v in checkpoints.checkpoints.values()),
        "pending_interrupts": len([i for i in interrupts.values() if i["status"] == "pending"]),
    }
