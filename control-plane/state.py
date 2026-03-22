"""In-memory session and task state management."""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

logger = logging.getLogger(__name__)

# Valid state transitions
SESSION_TRANSITIONS = {
    "CREATED": ["RUNNING", "CLOSED"],
    "RUNNING": ["PAUSED", "COMPLETED", "FAILED", "CLOSED"],
    "PAUSED": ["RUNNING", "CLOSED"],
    "COMPLETED": [],
    "FAILED": ["RUNNING", "CLOSED"],
    "CLOSED": [],
}

class SessionStore:
    """In-memory session store. Replace with PostgreSQL for production."""

    def __init__(self):
        self.sessions: dict[str, dict] = {}

    def create(self, worker_id: str = "", goal: str = "", workdir: str = ".") -> dict:
        session_id = str(uuid4())
        now = datetime.now(tz=timezone.utc).isoformat()
        session = {
            "id": session_id,
            "worker_id": worker_id,
            "goal": goal,
            "workdir": workdir,
            "status": "CREATED",
            "current_task": None,
            "step": 0,
            "created_at": now,
            "updated_at": now,
        }
        self.sessions[session_id] = session
        return session

    def get(self, session_id: str) -> dict | None:
        return self.sessions.get(session_id)

    def update(self, session_id: str, updates: dict) -> dict | None:
        session = self.sessions.get(session_id)
        if not session:
            return None

        # Validate state transition if status is changing
        if "status" in updates:
            old = session["status"]
            new = updates["status"]
            if new not in SESSION_TRANSITIONS.get(old, []):
                raise ValueError(f"Invalid transition: {old} \u2192 {new}")

        session.update(updates)
        session["updated_at"] = datetime.now(tz=timezone.utc).isoformat()
        return session

    def list_all(self, status: str | None = None) -> list[dict]:
        sessions = list(self.sessions.values())
        if status:
            sessions = [s for s in sessions if s["status"] == status]
        return sessions
