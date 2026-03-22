"""Audit logging and artifact lineage tracking."""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4

class AuditLog:
    def __init__(self):
        self.events: list[dict] = []
        self.artifacts: list[dict] = []

    def log_event(self, session_id: str, event_type: str, data: dict | None = None) -> dict:
        event = {
            "id": str(uuid4()),
            "session_id": session_id,
            "event_type": event_type,
            "data": data or {},
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
        self.events.append(event)
        return event

    def record_artifact(self, session_id: str, artifact_type: str, path: str, content: str = "", metadata: dict | None = None) -> dict:
        artifact = {
            "id": str(uuid4()),
            "session_id": session_id,
            "type": artifact_type,
            "path": path,
            "content": content[:5000],  # limit stored content
            "metadata": metadata or {},
            "created_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        self.artifacts.append(artifact)
        return artifact

    def get_events(self, session_id: str | None = None, limit: int = 100) -> list[dict]:
        events = self.events
        if session_id:
            events = [e for e in events if e["session_id"] == session_id]
        return events[-limit:]

    def get_artifacts(self, session_id: str | None = None) -> list[dict]:
        if session_id:
            return [a for a in self.artifacts if a["session_id"] == session_id]
        return self.artifacts
