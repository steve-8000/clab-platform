"""Shared test helpers."""

from uuid import uuid4
from datetime import datetime, timezone

from langgraph.knowledge.types import KnowledgeEntry


def make_entry(
    topic: str = "default topic",
    content: str = "default content",
    tags: list[str] | None = None,
    **kwargs,
) -> KnowledgeEntry:
    """Helper to create KnowledgeEntry with sensible defaults."""
    return KnowledgeEntry(
        id=kwargs.pop("id", str(uuid4())),
        topic=topic,
        content=content,
        tags=tags or [],
        source=kwargs.pop("source", "MANUAL"),
        confidence=kwargs.pop("confidence", 1.0),
        created_at=kwargs.pop(
            "created_at", datetime.now(tz=timezone.utc).isoformat()
        ),
        **kwargs,
    )
