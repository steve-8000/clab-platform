"""Worker registry — tracks connected local workers."""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class WorkerInfo:
    __slots__ = ("worker_id", "ws", "capabilities", "workdir", "status", "last_heartbeat", "connected_at", "hostname", "platform", "version")

    def __init__(
        self,
        worker_id: str,
        ws: WebSocket,
        capabilities: list[str],
        workdir: str,
        hostname: str = "",
        platform: str = "",
        version: str = "",
    ):
        self.worker_id = worker_id
        self.ws = ws
        self.capabilities = capabilities
        self.workdir = workdir
        self.status = "idle"
        self.hostname = hostname
        self.platform = platform
        self.version = version
        now = datetime.now(tz=timezone.utc).isoformat()
        self.last_heartbeat = now
        self.connected_at = now

    def to_dict(self) -> dict:
        return {
            "worker_id": self.worker_id,
            "capabilities": self.capabilities,
            "workdir": self.workdir,
            "status": self.status,
            "last_heartbeat": self.last_heartbeat,
            "connected_at": self.connected_at,
            "hostname": self.hostname,
            "platform": self.platform,
            "version": self.version,
        }

class WorkerRegistry:
    def __init__(self):
        self.workers: dict[str, WorkerInfo] = {}

    def register(
        self,
        worker_id: str,
        ws: WebSocket,
        capabilities: list[str],
        workdir: str,
        hostname: str = "",
        platform: str = "",
        version: str = "",
    ) -> WorkerInfo:
        worker = WorkerInfo(worker_id, ws, capabilities, workdir, hostname=hostname, platform=platform, version=version)
        self.workers[worker_id] = worker
        logger.info(f"Worker registered: {worker_id}")
        return worker

    def unregister(self, worker_id: str):
        if worker_id in self.workers:
            del self.workers[worker_id]
            logger.info(f"Worker unregistered: {worker_id}")

    def heartbeat(self, worker_id: str):
        worker = self.workers.get(worker_id)
        if worker:
            worker.last_heartbeat = datetime.now(tz=timezone.utc).isoformat()

    def list_all(self) -> list[dict]:
        return [w.to_dict() for w in self.workers.values()]

    def get(self, worker_id: str) -> WorkerInfo | None:
        return self.workers.get(worker_id)

    def get_ws(self, worker_id: str) -> WebSocket | None:
        worker = self.get(worker_id)
        return worker.ws if worker else None

    async def send_command(self, worker_id: str, command: dict) -> bool:
        ws = self.get_ws(worker_id)
        if not ws:
            return False
        try:
            await ws.send_json(command)
            return True
        except Exception:
            logger.exception("Failed to send command to worker %s", worker_id)
            return False
