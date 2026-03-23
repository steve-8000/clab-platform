"""Control Plane API server — thread/run runtime APIs with legacy session compatibility."""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .runtime_store import RuntimeStore
from .worker_registry import WorkerRegistry

logger = logging.getLogger(__name__)

store = RuntimeStore()
registry = WorkerRegistry()

# SSE subscribers: thread_id -> list[Queue[event]]
sse_queues: dict[str, list[asyncio.Queue]] = {}
runtime_sse_queues: dict[str, list[asyncio.Queue]] = {}

# Interrupt futures: interrupt_id -> Future[str]
interrupt_futures: dict[str, asyncio.Future] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Control Plane started")
    yield


app = FastAPI(title="Control Plane", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---- Helpers ----
def _as_jsonable(row: dict | None) -> dict | None:
    if not row:
        return None
    out = dict(row)
    for key in ("payload", "metadata", "checkpoint"):
        if key in out and isinstance(out[key], str):
            try:
                out[key] = json.loads(out[key])
            except json.JSONDecodeError:
                pass
    return out


def _format_session(thread: dict, run: dict | None) -> dict:
    run = run or {}
    return {
        "id": thread["id"],  # session_id compatibility: session == thread
        "thread_id": thread["id"],
        "run_id": run.get("id"),
        "worker_id": thread.get("worker_id", ""),
        "goal": thread.get("goal", ""),
        "workdir": thread.get("workdir", "."),
        "status": run.get("status", thread.get("status", "CREATED")),
        "current_task": run.get("current_task"),
        "step": run.get("step", 0),
        "created_at": thread.get("created_at"),
        "updated_at": run.get("updated_at", thread.get("updated_at")),
    }


def _push_sse(thread_id: str, event: dict):
    for q in sse_queues.get(thread_id, []):
        q.put_nowait(event)


def _push_runtime_sse(scope: str, event: dict):
    for q in runtime_sse_queues.get(scope, []):
        q.put_nowait(event)
    for q in runtime_sse_queues.get("__all__", []):
        q.put_nowait(event)


def _publish_dispatch_event(worker_id: str, dispatch: dict | None, event_type: str):
    dispatch_payload = _as_jsonable(dispatch)
    if not dispatch_payload:
        return
    _push_runtime_sse(
        worker_id,
        {
            "type": event_type,
            "worker_id": worker_id,
            "dispatch": dispatch_payload,
        },
    )


def _normalize_status(value: str | None) -> str | None:
    if value is None:
        return None
    mapping = {
        "CLOSED": "CANCELED",
    }
    return mapping.get(value, value)


def _append_and_publish_event(thread_id: str, run_id: str | None, event_type: str, payload: dict[str, Any]) -> dict:
    event = _as_jsonable(store.append_event(thread_id, run_id, event_type, payload)) or {}
    shaped = {
        "event_id": event.get("id"),
        "thread_id": event.get("thread_id", thread_id),
        "run_id": event.get("run_id", run_id),
        "type": event.get("type", event_type),
        "seq": event.get("seq", 0),
        "ts": event.get("ts"),
        "payload": event.get("payload", payload),
    }
    _push_sse(thread_id, shaped)
    return shaped


def _ensure_thread(thread_id: str, worker_id: str = "", goal: str = "", workdir: str = ".") -> dict:
    thread = _as_jsonable(store.get_thread(thread_id))
    if thread:
        return thread
    created = _as_jsonable(store.create_thread_with_id(thread_id, worker_id=worker_id, goal=goal, workdir=workdir))
    if not created:
        raise HTTPException(500, "Failed to create thread")
    return created


# ---- Request models ----
class CreateThreadRequest(BaseModel):
    worker_id: str = ""
    goal: str = ""
    workdir: str = "."


class CreateRunRequest(BaseModel):
    status: str = "CREATED"


class UpdateRunRequest(BaseModel):
    status: str | None = None
    current_task: str | None = None
    step: int | None = None


class PutCheckpointRequest(BaseModel):
    checkpoint: dict
    metadata: dict = {}


class CreateInterruptRequest(BaseModel):
    session_id: str | None = None  # legacy alias
    thread_id: str | None = None
    run_id: str | None = None
    value: str


class ResolveInterruptRequest(BaseModel):
    resume_value: str


class RecordArtifactRequest(BaseModel):
    session_id: str | None = None  # legacy alias
    thread_id: str | None = None
    run_id: str | None = None
    type: str
    path: str
    content: str = ""
    metadata: dict = {}


class CreateSessionRequest(BaseModel):
    worker_id: str = ""
    goal: str = ""
    workdir: str = "."


class UpdateSessionRequest(BaseModel):
    status: str | None = None
    current_task: str | None = None
    step: int | None = None


class DispatchMissionRequest(BaseModel):
    worker_id: str
    goal: str
    workdir: str = "."
    parallel: bool = True
    workspace_id: str | None = None


class DispatchPromptRequest(BaseModel):
    worker_id: str
    surface_id: str
    prompt: str
    workspace_id: str | None = None


class DispatchCancelRequest(BaseModel):
    worker_id: str
    workspace_id: str | None = None
    run_id: str | None = None


# ---- Thread / Run APIs ----
@app.post("/threads")
def create_thread(req: CreateThreadRequest):
    thread = _as_jsonable(store.create_thread(req.worker_id, req.goal, req.workdir))
    if not thread:
        raise HTTPException(500, "Failed to create thread")
    event = _append_and_publish_event(thread["id"], None, "thread.created", {"goal": req.goal})
    return {"thread": thread, "event": event}


@app.get("/threads/{thread_id}")
def get_thread(thread_id: str):
    thread = _as_jsonable(store.get_thread(thread_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    return thread


@app.get("/threads")
def list_threads(status: str | None = None):
    return [_as_jsonable(t) for t in store.list_threads(status)]


@app.post("/threads/{thread_id}/runs")
def create_run(thread_id: str, req: CreateRunRequest):
    thread = _as_jsonable(store.get_thread(thread_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    try:
        run = _as_jsonable(store.create_run(thread_id))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not run:
        raise HTTPException(500, "Failed to create run")
    desired_status = _normalize_status(req.status)
    if desired_status != "CREATED":
        run = _as_jsonable(store.update_run(run["id"], {"status": desired_status}))
    event = _append_and_publish_event(thread_id, run["id"], "run.created", {"status": run["status"]})
    return {"run": run, "event": event}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = _as_jsonable(store.get_run(run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.patch("/runs/{run_id}")
def update_run(run_id: str, req: UpdateRunRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if "status" in updates:
        updates["status"] = _normalize_status(updates["status"])
    try:
        run = _as_jsonable(store.update_run(run_id, updates))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not run:
        raise HTTPException(404, "Run not found")
    _append_and_publish_event(run["thread_id"], run_id, "run.updated", updates)
    return run


# ---- Legacy Sessions API (compatibility layer) ----
@app.post("/sessions")
def create_session(req: CreateSessionRequest):
    thread = _as_jsonable(store.create_thread(req.worker_id, req.goal, req.workdir))
    if not thread:
        raise HTTPException(500, "Failed to create session(thread)")
    run = _as_jsonable(store.create_run(thread["id"]))
    _append_and_publish_event(thread["id"], run["id"], "session.created", {"goal": req.goal})
    return _format_session(thread, run)


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    thread = _as_jsonable(store.get_thread(session_id))
    if not thread:
        raise HTTPException(404, "Session not found")
    run = _as_jsonable(store.get_latest_run_for_thread(session_id))
    return _format_session(thread, run)


@app.patch("/sessions/{session_id}")
def update_session(session_id: str, req: UpdateSessionRequest):
    thread = _as_jsonable(store.get_thread(session_id))
    if not thread:
        raise HTTPException(404, "Session not found")
    run = _as_jsonable(store.get_latest_run_for_thread(session_id))
    if not run:
        run = _as_jsonable(store.create_run(session_id))
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if "status" in updates:
        updates["status"] = _normalize_status(updates["status"])
    try:
        run = _as_jsonable(store.update_run(run["id"], updates))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not run:
        raise HTTPException(404, "Session run not found")
    _append_and_publish_event(session_id, run["id"], "session.updated", updates)
    thread = _as_jsonable(store.get_thread(session_id))
    return _format_session(thread, run) if thread else {"error": "thread not found"}


@app.get("/sessions")
def list_sessions(status: str | None = None):
    rows = []
    for thread in store.list_threads(status):
        t = _as_jsonable(thread) or {}
        run = _as_jsonable(store.get_latest_run_for_thread(t["id"])) if t.get("id") else None
        rows.append(_format_session(t, run))
    return rows


# ---- Checkpoints ----
@app.get("/checkpoints/{thread_id}")
def get_checkpoint(thread_id: str):
    cp = _as_jsonable(store.get_latest_checkpoint(thread_id))
    if not cp:
        raise HTTPException(404, "No checkpoint found")
    return cp


@app.put("/checkpoints/{thread_id}")
def put_checkpoint(thread_id: str, req: PutCheckpointRequest):
    # Keep legacy behavior: if thread doesn't exist yet, create lightweight thread row.
    thread = _as_jsonable(store.get_thread(thread_id))
    if not thread:
        _ensure_thread(thread_id)
    cp = _as_jsonable(store.put_checkpoint(thread_id, req.checkpoint, req.metadata))
    if not cp:
        raise HTTPException(500, "Failed to save checkpoint")
    _append_and_publish_event(thread_id, cp.get("run_id"), "checkpoint.saved", {"checkpoint_id": cp["id"]})
    return cp


@app.get("/checkpoints/{thread_id}/history")
def checkpoint_history(thread_id: str, limit: int = 10):
    return [_as_jsonable(cp) for cp in store.list_checkpoints(thread_id, limit)]


@app.get("/threads/{thread_id}/checkpoints")
def list_thread_checkpoints(thread_id: str, limit: int = 20):
    return [_as_jsonable(cp) for cp in store.list_checkpoints(thread_id, limit)]


@app.get("/checkpoints/by-id/{checkpoint_id}")
def get_checkpoint_by_id(checkpoint_id: str):
    cp = _as_jsonable(store.get_checkpoint(checkpoint_id))
    if not cp:
        raise HTTPException(404, "Checkpoint not found")
    return cp


# ---- Interrupts ----
@app.post("/interrupts")
async def create_interrupt(req: CreateInterruptRequest):
    thread_id = req.thread_id or req.session_id
    if not thread_id:
        raise HTTPException(400, "thread_id or session_id is required")
    thread = _as_jsonable(store.get_thread(thread_id))
    if not thread:
        raise HTTPException(404, "Thread not found")

    run_id = req.run_id
    if not run_id:
        latest = _as_jsonable(store.get_latest_run_for_thread(thread_id))
        run_id = latest.get("id") if latest else None
    intr = _as_jsonable(store.create_interrupt(thread_id, run_id, req.value))
    if not intr:
        raise HTTPException(500, "Failed to create interrupt")

    future = asyncio.get_event_loop().create_future()
    interrupt_futures[intr["id"]] = future
    _append_and_publish_event(thread_id, run_id, "interrupt.created", {"interrupt_id": intr["id"], "value": req.value})

    shaped = dict(intr)
    shaped["session_id"] = thread_id  # legacy field
    return shaped


@app.post("/runs/{run_id}/interrupts")
async def create_run_interrupt(run_id: str, req: CreateInterruptRequest):
    run = _as_jsonable(store.get_run(run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    intr = _as_jsonable(store.create_interrupt(run["thread_id"], run_id, req.value))
    if not intr:
        raise HTTPException(500, "Failed to create interrupt")
    future = asyncio.get_event_loop().create_future()
    interrupt_futures[intr["id"]] = future
    _append_and_publish_event(run["thread_id"], run_id, "interrupt.created", {"interrupt_id": intr["id"], "value": req.value})
    return intr


@app.get("/interrupts/{interrupt_id}")
def get_interrupt(interrupt_id: str):
    intr = _as_jsonable(store.get_interrupt(interrupt_id))
    if not intr:
        raise HTTPException(404, "Interrupt not found")
    shaped = dict(intr)
    shaped["session_id"] = intr.get("thread_id")  # legacy field
    return shaped


@app.post("/interrupts/{interrupt_id}/resolve")
async def resolve_interrupt(interrupt_id: str, req: ResolveInterruptRequest):
    intr = _as_jsonable(store.resolve_interrupt(interrupt_id, req.resume_value))
    if not intr:
        raise HTTPException(404, "Interrupt not found")
    future = interrupt_futures.pop(interrupt_id, None)
    if future and not future.done():
        future.set_result(req.resume_value)
    _append_and_publish_event(
        intr["thread_id"],
        intr.get("run_id"),
        "interrupt.resolved",
        {"interrupt_id": interrupt_id},
    )
    shaped = dict(intr)
    shaped["session_id"] = intr.get("thread_id")
    return shaped


@app.get("/interrupts")
def list_interrupts(
    session_id: str | None = None,  # legacy alias
    thread_id: str | None = None,
    run_id: str | None = None,
    status: str | None = None,
):
    tid = thread_id or session_id
    rows = [
        _as_jsonable(i)
        for i in store.list_interrupts(thread_id=tid, run_id=run_id, status=status)
    ]
    for row in rows:
        if row is not None:
            row["session_id"] = row.get("thread_id")
    return rows


# ---- Workers / WS ----
@app.get("/workers")
def list_workers():
    return registry.list_all()


@app.get("/workspaces")
async def list_workspaces(worker_id: str | None = None):
    rows = await store.list_workspaces(worker_id)
    return [_as_jsonable(r) for r in rows]


@app.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str):
    ws_row = await store.get_workspace(workspace_id)
    ws = _as_jsonable(ws_row)
    if not ws:
        raise HTTPException(404)
    surfaces = await store.list_surfaces(workspace_id)
    ws["surfaces"] = [_as_jsonable(s) for s in surfaces]
    return _as_jsonable(ws)


@app.get("/workspaces/{workspace_id}/surfaces")
async def list_surfaces(workspace_id: str):
    return [_as_jsonable(s) for s in await store.list_surfaces(workspace_id)]


@app.get("/workers/{worker_id}/workspaces")
async def worker_workspaces(worker_id: str):
    return [_as_jsonable(r) for r in await store.list_workspaces(worker_id)]


@app.post("/dispatch/mission")
async def dispatch_mission(req: DispatchMissionRequest):
    cmd = await store.create_dispatch(
        worker_id=req.worker_id,
        command_type="mission",
        payload={"goal": req.goal, "workdir": req.workdir, "parallel": req.parallel},
        workspace_id=req.workspace_id,
    )
    sent = await registry.send_command(req.worker_id, {
        "type": "command.dispatch",
        "command_id": cmd["id"],
        "command_type": "mission",
        "payload": cmd["payload"],
    })
    status = "sent" if sent else "queued"
    dispatch = await store.update_dispatch_status(cmd["id"], status)
    _publish_dispatch_event(req.worker_id, dispatch, "dispatch.updated")
    return _as_jsonable(await store.get_dispatch(cmd["id"]))


@app.post("/dispatch/prompt")
async def dispatch_prompt(req: DispatchPromptRequest):
    cmd = await store.create_dispatch(
        worker_id=req.worker_id,
        command_type="prompt",
        payload={"prompt": req.prompt, "surface_id": req.surface_id},
        workspace_id=req.workspace_id,
        surface_id=req.surface_id,
    )
    sent = await registry.send_command(req.worker_id, {
        "type": "command.dispatch",
        "command_id": cmd["id"],
        "command_type": "prompt",
        "payload": cmd["payload"],
    })
    status = "sent" if sent else "queued"
    dispatch = await store.update_dispatch_status(cmd["id"], status)
    _publish_dispatch_event(req.worker_id, dispatch, "dispatch.updated")
    return _as_jsonable(await store.get_dispatch(cmd["id"]))


@app.post("/dispatch/cancel")
async def dispatch_cancel(req: DispatchCancelRequest):
    cmd = await store.create_dispatch(
        worker_id=req.worker_id,
        command_type="cancel",
        payload={"workspace_id": req.workspace_id, "run_id": req.run_id},
        workspace_id=req.workspace_id,
    )
    sent = await registry.send_command(req.worker_id, {
        "type": "command.cancel",
        "command_id": cmd["id"],
        "payload": cmd["payload"],
    })
    status = "sent" if sent else "queued"
    dispatch = await store.update_dispatch_status(cmd["id"], status)
    _publish_dispatch_event(req.worker_id, dispatch, "dispatch.updated")
    return _as_jsonable(await store.get_dispatch(cmd["id"]))


@app.get("/dispatches")
async def list_dispatches(worker_id: str | None = None, status: str | None = None):
    return [_as_jsonable(r) for r in await store.list_dispatches(worker_id, status)]


@app.get("/dispatches/{command_id}")
async def get_dispatch(command_id: str):
    dispatch = await store.get_dispatch(command_id)
    d = _as_jsonable(dispatch)
    if not d:
        raise HTTPException(404)
    return d


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
        worker = registry.register(
            worker_id,
            ws,
            msg.get("capabilities", []),
            msg.get("workdir", "."),
            hostname=msg.get("hostname", ""),
            platform=msg.get("platform", ""),
            version=msg.get("version", ""),
        )
        await store.upsert_worker(
            worker_id=worker_id,
            hostname=worker.hostname,
            platform=worker.platform,
            capabilities=worker.capabilities,
            workdir=worker.workdir,
            status="online",
            version=worker.version,
        )
        _push_runtime_sse(worker_id, {"type": "worker.connected", "worker_id": worker_id})

        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "heartbeat":
                registry.heartbeat(worker_id)
                await store.update_worker_heartbeat(worker_id)
                continue

            if msg_type == "state_update":
                # v1 compatibility: session_id -> thread_id
                thread_id = msg.get("thread_id") or msg.get("session_id")
                if not thread_id:
                    continue

                thread = _as_jsonable(store.get_thread(thread_id))
                if not thread:
                    continue

                run_id = msg.get("run_id")
                run = _as_jsonable(store.get_run(run_id)) if run_id else _as_jsonable(store.get_latest_run_for_thread(thread_id))
                if not run:
                    run = _as_jsonable(store.create_run(thread_id))
                if not run:
                    continue
                updates = {
                    "status": _normalize_status(msg.get("status", run.get("status", "RUNNING"))),
                    "current_task": msg.get("current_task"),
                    "step": msg.get("step", run.get("step", 0)),
                }
                try:
                    updated = _as_jsonable(store.update_run(run["id"], updates))
                except ValueError:
                    updated = run
                if updated:
                    _append_and_publish_event(
                        thread_id,
                        updated["id"],
                        "run.state_update",
                        {
                            "status": updated["status"],
                            "current_task": updated.get("current_task"),
                            "step": updated.get("step", 0),
                        },
                    )
                continue

            if msg_type == "run_state":
                # v2 native message
                thread_id = msg.get("thread_id")
                run_id = msg.get("run_id")
                if not thread_id or not run_id:
                    continue
                run = _as_jsonable(store.get_run(run_id))
                if not run:
                    continue
                updates = {
                    "status": _normalize_status(msg.get("status", run["status"])),
                    "current_task": msg.get("current_task"),
                    "step": msg.get("step", run.get("step", 0)),
                }
                try:
                    updated = _as_jsonable(store.update_run(run_id, updates))
                except ValueError:
                    updated = run
                if updated:
                    _append_and_publish_event(thread_id, run_id, "run.state_update", updates)
                continue

            if msg_type in ("stream", "stream_event"):
                thread_id = msg.get("thread_id") or msg.get("session_id")
                if not thread_id:
                    continue
                run_id = msg.get("run_id")
                event_type = msg.get("event_type", "stream")
                payload = msg.get("data", {})
                _append_and_publish_event(thread_id, run_id, event_type, payload)
                continue

            if msg_type == "artifact":
                thread_id = msg.get("thread_id") or msg.get("session_id")
                if not thread_id:
                    continue
                run_id = msg.get("run_id")
                store.record_artifact(
                    thread_id=thread_id,
                    run_id=run_id,
                    artifact_type=msg.get("artifact_type", "FILE"),
                    path=msg.get("path", ""),
                    content=msg.get("content", ""),
                    metadata={},
                )
                _append_and_publish_event(
                    thread_id,
                    run_id,
                    "artifact.recorded",
                    {"path": msg.get("path", ""), "type": msg.get("artifact_type", "FILE")},
                )
                continue

            if msg_type == "cmux.snapshot":
                await store.delete_workspaces_for_worker(worker_id)
                for ws_data in msg.get("workspaces", []):
                    ws_id = f"{worker_id}_{ws_data['workspace_id']}"
                    await store.upsert_workspace(
                        id=ws_id,
                        worker_id=worker_id,
                        workspace_id=ws_data["workspace_id"],
                        name=ws_data.get("name", ""),
                        role=ws_data.get("role", "agent"),
                        status=ws_data.get("status", "idle"),
                        current_thread_id=ws_data.get("thread_id"),
                        current_run_id=ws_data.get("run_id"),
                    )
                    for sf_data in ws_data.get("surfaces", []):
                        sf_id = f"{worker_id}_{sf_data['surface_id']}"
                        await store.upsert_surface(
                            id=sf_id,
                            worker_id=worker_id,
                            workspace_id=ws_id,
                            surface_id=sf_data["surface_id"],
                            name=sf_data.get("name", ""),
                            role=sf_data.get("role", "worker"),
                            engine=sf_data.get("engine", "codex"),
                            status=sf_data.get("status", "idle"),
                            last_output_excerpt=sf_data.get("last_output_excerpt", ""),
                        )
                _push_runtime_sse(worker_id, {"type": "workspace.snapshot", "worker_id": worker_id})
                continue

            if msg_type == "command.ack":
                command_id = msg.get("command_id")
                if command_id:
                    dispatch = await store.update_dispatch_status(command_id, "acked")
                    _publish_dispatch_event(worker_id, dispatch, "dispatch.acked")
                continue

            if msg_type == "command.result":
                command_id = msg.get("command_id")
                if command_id:
                    result_status = msg.get("status", "completed")
                    result = await store.create_dispatch_result(command_id, result_status, msg.get("payload", {}))
                    dispatch = await store.update_dispatch_status(command_id, result_status)
                    _push_runtime_sse(
                        worker_id,
                        {
                            "type": "dispatch.result",
                            "worker_id": worker_id,
                            "dispatch": _as_jsonable(dispatch),
                            "result": _as_jsonable(result),
                        },
                    )
                continue

    except WebSocketDisconnect:
        pass
    finally:
        if worker_id:
            await store.update_worker_status(worker_id, "offline")
            _push_runtime_sse(worker_id, {"type": "worker.disconnected", "worker_id": worker_id})
            registry.unregister(worker_id)


# ---- Events / SSE ----
@app.get("/threads/{thread_id}/events", response_model=None)
async def thread_events(thread_id: str, since_seq: int = 0):
    queue: asyncio.Queue = asyncio.Queue()
    if thread_id not in sse_queues:
        sse_queues[thread_id] = []
    sse_queues[thread_id].append(queue)

    backlog = store.list_events(thread_id, since_seq=since_seq, limit=500)

    async def event_generator():
        try:
            for raw in backlog:
                event = _as_jsonable(raw) or {}
                shaped = {
                    "event_id": event.get("id"),
                    "thread_id": event.get("thread_id"),
                    "run_id": event.get("run_id"),
                    "type": event.get("type"),
                    "seq": event.get("seq"),
                    "ts": event.get("ts"),
                    "payload": event.get("payload", {}),
                }
                yield f"data: {json.dumps(shaped)}\n\n"

            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_queues[thread_id].remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/events/{session_id}", response_model=None)
async def session_events(session_id: str, since_seq: int = 0):
    # Legacy alias
    return thread_events(session_id, since_seq=since_seq)


@app.get("/events/runtime", response_model=None)
async def runtime_events(worker_id: str | None = None):
    scope = worker_id or "__all__"
    q: asyncio.Queue = asyncio.Queue()
    runtime_sse_queues.setdefault(scope, []).append(q)

    async def stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            runtime_sse_queues[scope].remove(q)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---- Artifacts / Audit ----
@app.post("/artifacts")
def record_artifact(req: RecordArtifactRequest):
    thread_id = req.thread_id or req.session_id
    if not thread_id:
        raise HTTPException(400, "thread_id or session_id is required")
    artifact = _as_jsonable(
        store.record_artifact(
            thread_id=thread_id,
            run_id=req.run_id,
            artifact_type=req.type,
            path=req.path,
            content=req.content,
            metadata=req.metadata,
        )
    )
    if not artifact:
        raise HTTPException(500, "Failed to record artifact")
    _append_and_publish_event(
        thread_id,
        req.run_id,
        "artifact.recorded",
        {"path": req.path, "type": req.type},
    )
    return artifact


@app.get("/artifacts")
def list_artifacts(session_id: str | None = None, thread_id: str | None = None, run_id: str | None = None):
    tid = thread_id or session_id
    return [_as_jsonable(a) for a in store.list_artifacts(thread_id=tid, run_id=run_id)]


@app.get("/audit")
def list_audit_events(session_id: str | None = None, thread_id: str | None = None, run_id: str | None = None, limit: int = 100):
    tid = thread_id or session_id
    if not tid:
        # Keep endpoint predictable without global scans.
        raise HTTPException(400, "thread_id or session_id is required")
    rows = store.list_events(tid, since_seq=0, limit=limit)
    result = [_as_jsonable(e) for e in rows]
    if run_id:
        result = [e for e in result if e and e.get("run_id") == run_id]
    return result


# ---- Health ----
@app.get("/health")
def health():
    stats = store.stats()
    return {
        "status": "ok",
        "service": "control-plane",
        **stats,
    }
