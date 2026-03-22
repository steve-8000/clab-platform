"""Checkpoint storage exposed via HTTP for remote LangGraph agents."""
from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

class CheckpointStore:
    """In-memory checkpoint store. Replace with PostgreSQL for production."""

    def __init__(self):
        self.checkpoints: dict[str, list[dict]] = {}  # thread_id -> [checkpoint, ...]

    def get_latest(self, thread_id: str) -> dict | None:
        history = self.checkpoints.get(thread_id, [])
        return history[-1] if history else None

    def put(self, thread_id: str, checkpoint: dict, metadata: dict) -> dict:
        if thread_id not in self.checkpoints:
            self.checkpoints[thread_id] = []

        entry = {
            "thread_id": thread_id,
            "checkpoint_id": checkpoint.get("id", ""),
            "checkpoint": checkpoint,
            "metadata": metadata,
            "created_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        self.checkpoints[thread_id].append(entry)
        return entry

    def get_history(self, thread_id: str, limit: int = 10) -> list[dict]:
        history = self.checkpoints.get(thread_id, [])
        return list(reversed(history[-limit:]))

    def get_by_id(self, thread_id: str, checkpoint_id: str) -> dict | None:
        for cp in self.checkpoints.get(thread_id, []):
            if cp["checkpoint_id"] == checkpoint_id:
                return cp
        return None
