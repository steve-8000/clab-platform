"""Event emitter for streaming agent progress to Control Plane."""
from __future__ import annotations
import logging
from local_agent.sync.ws_client import ControlPlaneSync

logger = logging.getLogger(__name__)


class EventEmitter:
    """Wraps ControlPlaneSync for convenient event emission from graph nodes."""

    def __init__(self, sync: ControlPlaneSync | None = None):
        self.sync = sync
        self.session_id: str | None = None

    async def on_task_start(self, task_id: str, task_title: str, step: int):
        if not self.sync or not self.session_id:
            return
        await self.sync.send_state_update(self.session_id, "RUNNING", task_title, step)
        await self.sync.send_stream_event(self.session_id, "task.start", {
            "task_id": task_id, "title": task_title, "step": step,
        })

    async def on_task_complete(self, task_id: str, task_title: str, success: bool):
        if not self.sync or not self.session_id:
            return
        event_type = "task.success" if success else "task.failed"
        await self.sync.send_stream_event(self.session_id, event_type, {
            "task_id": task_id, "title": task_title,
        })

    async def on_plan_created(self, task_count: int):
        if not self.sync or not self.session_id:
            return
        await self.sync.send_stream_event(self.session_id, "plan.created", {
            "task_count": task_count,
        })

    async def on_replan(self, reason: str):
        if not self.sync or not self.session_id:
            return
        await self.sync.send_stream_event(self.session_id, "replan", {"reason": reason})

    async def on_complete(self, completed: int, failed: int, insights: int):
        if not self.sync or not self.session_id:
            return
        await self.sync.send_state_update(self.session_id, "COMPLETED")
        await self.sync.send_stream_event(self.session_id, "agent.complete", {
            "completed_tasks": completed, "failed_tasks": failed, "insights": insights,
        })

    async def on_artifact(self, artifact_type: str, path: str, content: str = ""):
        if not self.sync or not self.session_id:
            return
        await self.sync.send_artifact(self.session_id, artifact_type, path, content)
