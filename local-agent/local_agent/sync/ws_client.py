"""WebSocket client for syncing state with Control Plane."""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class ControlPlaneSync:
    """Manages WebSocket connection to Control Plane for state updates and events."""

    def __init__(self, control_plane_url: str, worker_id: str, capabilities: list[str] | None = None, workdir: str = "."):
        # Convert http(s) to ws(s)
        ws_url = control_plane_url.replace("https://", "wss://").replace("http://", "ws://")
        self.ws_url = f"{ws_url}/ws/worker"
        self.worker_id = worker_id
        self.capabilities = capabilities or ["claude", "codex"]
        self.workdir = workdir
        self.ws = None
        self.session_id: str | None = None
        self._heartbeat_task: asyncio.Task | None = None

    async def connect(self):
        """Connect to Control Plane WebSocket."""
        import websockets
        self.ws = await websockets.connect(self.ws_url)

        # Register
        await self.ws.send(json.dumps({
            "type": "register",
            "worker_id": self.worker_id,
            "capabilities": self.capabilities,
            "workdir": self.workdir,
        }))

        # Start heartbeat
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info(f"Connected to Control Plane as {self.worker_id}")

    async def disconnect(self):
        """Disconnect from Control Plane."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self.ws:
            await self.ws.close()
            self.ws = None

    async def send_state_update(
        self,
        session_id: str,
        status: str,
        current_task: str = "",
        step: int = 0,
        run_id: str | None = None,
    ):
        """Send state update to Control Plane."""
        if not self.ws:
            return
        self.session_id = session_id
        payload = {
            "type": "state_update",
            "session_id": session_id,
            "thread_id": session_id,  # v2 alias
            "run_id": run_id,
            "status": status,
            "current_task": current_task,
            "step": step,
        }
        await self.ws.send(json.dumps(payload))

    async def send_stream_event(self, session_id: str, event_type: str, data: dict, run_id: str | None = None):
        """Send streaming event (forwarded to SSE subscribers via Control Plane)."""
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "stream_event",
            "session_id": session_id,
            "thread_id": session_id,
            "run_id": run_id,
            "event_type": event_type,
            "data": data,
        }))

    async def send_artifact(
        self,
        session_id: str,
        artifact_type: str,
        path: str,
        content: str = "",
        run_id: str | None = None,
    ):
        """Report an artifact to Control Plane."""
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "artifact",
            "session_id": session_id,
            "thread_id": session_id,
            "run_id": run_id,
            "artifact_type": artifact_type,
            "path": path,
            "content": content[:5000],
        }))

    async def _heartbeat_loop(self):
        """Send periodic heartbeats."""
        try:
            while True:
                await asyncio.sleep(30)
                if self.ws:
                    await self.ws.send(json.dumps({
                        "type": "heartbeat",
                        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                    }))
        except asyncio.CancelledError:
            pass
