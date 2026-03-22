import json
import dataclasses
import sys
import pytest
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

from langgraph.knowledge.types import KnowledgeEntry


def _model_dump_json(self, indent: int = 2) -> str:
    """Polyfill for model_dump_json on stdlib dataclasses."""
    return json.dumps(dataclasses.asdict(self), indent=indent)


# Patch KnowledgeEntry so LocalKnowledgeStore.store() works with stdlib dataclass
if not hasattr(KnowledgeEntry, "model_dump_json"):
    KnowledgeEntry.model_dump_json = _model_dump_json  # type: ignore[attr-defined]


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


@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def knowledge_store(tmp_dir: Path):
    from langgraph.knowledge.local_store import LocalKnowledgeStore

    return LocalKnowledgeStore(str(tmp_dir / "knowledge"))


@pytest.fixture
def sample_entry() -> KnowledgeEntry:
    return KnowledgeEntry(
        id=str(uuid4()),
        topic="Python testing",
        content="Use pytest for Python testing. It supports fixtures, parametrize, and async tests.",
        tags=["python", "testing", "pytest"],
        source="MANUAL",
        confidence=0.9,
        created_at=datetime.now(tz=timezone.utc).isoformat(),
    )
