"""Control Plane state reporter — reports execution lifecycle to K8s CP.

All calls are fail-safe: if CP is unreachable, local execution continues.
"""

from __future__ import annotations

import logging
import os
import httpx

logger = logging.getLogger(__name__)

_CP_URL = os.getenv("CLAB_CONTROL_URL", "https://ai.clab.one/api/cp")


class CPReporter:
    """Thin async HTTP client that reports graph execution state to Control Plane."""

    def __init__(self, control_plane_url: str | None = None) -> None:
        self.url = (control_plane_url or _CP_URL).rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.url, timeout=10.0)
        self.thread_id: str | None = None
        self.run_id: str | None = None

    async def start_session(
        self, goal: str, workdir: str, worker_id: str = "local"
    ) -> tuple[str, str]:
        """Create thread + run on CP. Returns (thread_id, run_id)."""
        resp = await self._client.post(
            "/threads",
            json={"worker_id": worker_id, "goal": goal, "workdir": workdir},
        )
        resp.raise_for_status()
        thread = resp.json().get("thread", {})
        self.thread_id = thread["id"]

        resp = await self._client.post(
            f"/threads/{self.thread_id}/runs", json={"status": "RUNNING"}
        )
        resp.raise_for_status()
        run = resp.json().get("run", {})
        self.run_id = run["id"]
        logger.info("CP session started: thread=%s run=%s", self.thread_id, self.run_id)
        return self.thread_id, self.run_id

    async def report_task_start(self, task_title: str, step: int) -> None:
        if not self.run_id:
            return
        try:
            await self._client.patch(
                f"/runs/{self.run_id}",
                json={"status": "RUNNING", "current_task": task_title, "step": step},
            )
        except Exception as exc:
            logger.debug("CP report_task_start failed: %s", exc)

    async def report_task_complete(self, task_title: str, result: str) -> None:
        if not self.thread_id:
            return
        try:
            await self._client.post(
                "/artifacts",
                json={
                    "thread_id": self.thread_id,
                    "run_id": self.run_id,
                    "type": "TASK_RESULT",
                    "path": task_title,
                    "content": result[:5000],
                },
            )
        except Exception as exc:
            logger.debug("CP report_task_complete failed: %s", exc)

    async def report_finished(self, success: bool) -> None:
        if not self.run_id:
            return
        status = "COMPLETED" if success else "FAILED"
        try:
            await self._client.patch(
                f"/runs/{self.run_id}", json={"status": status}
            )
            logger.info("CP session finished: run=%s status=%s", self.run_id, status)
        except Exception as exc:
            logger.debug("CP report_finished failed: %s", exc)

    async def close(self) -> None:
        await self._client.aclose()
