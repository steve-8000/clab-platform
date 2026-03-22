"""File-based JSON implementation of KnowledgeStore."""

import asyncio
import json
import dataclasses
from pathlib import Path

from langgraph.knowledge.store import KnowledgeStore
from langgraph.knowledge.types import KnowledgeEntry, StoreStatus


class LocalKnowledgeStore(KnowledgeStore):
    """Stores each KnowledgeEntry as a JSON file in a local directory."""

    def __init__(self, directory: str | Path) -> None:
        self._dir = Path(directory)
        self._dir.mkdir(parents=True, exist_ok=True)

    def _entry_path(self, id: str) -> Path:
        return self._dir / f"{id}.json"

    async def _read_entry(self, path: Path) -> KnowledgeEntry:
        data = await asyncio.to_thread(path.read_text, encoding="utf-8")
        return KnowledgeEntry(**json.loads(data))

    async def _read_all(self) -> list[KnowledgeEntry]:
        paths = await asyncio.to_thread(lambda: list(self._dir.glob("*.json")))
        entries = await asyncio.gather(*(self._read_entry(p) for p in paths))
        return list(entries)

    async def store(self, entry: KnowledgeEntry) -> KnowledgeEntry:
        """Store entry as {id}.json. Overwrites if exists."""
        path = self._entry_path(entry.id)
        data = json.dumps(dataclasses.asdict(entry), indent=2)
        await asyncio.to_thread(path.write_text, data, "utf-8")
        return entry

    async def search(self, query: str, *, limit: int = 10) -> list[KnowledgeEntry]:
        """Keyword search with scoring: topic=3, content=2, tag=1."""
        entries = await self._read_all()
        terms = query.lower().split()
        if not terms:
            return []

        scored: list[tuple[float, KnowledgeEntry]] = []
        for entry in entries:
            score = 0.0
            topic_lower = entry.topic.lower()
            content_lower = entry.content.lower()
            tags_lower = [t.lower() for t in entry.tags]
            for term in terms:
                if term in topic_lower:
                    score += 3
                if term in content_lower:
                    score += 2
                if any(term in tag for tag in tags_lower):
                    score += 1
            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [entry for _, entry in scored[:limit]]

    async def get_by_topic(self, topic: str) -> list[KnowledgeEntry]:
        """Exact case-insensitive topic match."""
        entries = await self._read_all()
        topic_lower = topic.lower()
        return [e for e in entries if e.topic.lower() == topic_lower]

    async def get_by_tags(self, tags: list[str]) -> list[KnowledgeEntry]:
        """Return entries matching any of the given tags (case-insensitive)."""
        entries = await self._read_all()
        tags_lower = {t.lower() for t in tags}
        return [
            e for e in entries
            if any(t.lower() in tags_lower for t in e.tags)
        ]

    async def status(self) -> StoreStatus:
        """Return total entries, unique topics, and last updated timestamp."""
        entries = await self._read_all()
        if not entries:
            return StoreStatus()

        topics = {e.topic for e in entries}
        timestamps = [e.updated_at or e.created_at for e in entries]
        last = max(timestamps) if timestamps else None

        return StoreStatus(
            total_entries=len(entries),
            unique_topics=len(topics),
            last_updated=last,
        )

    async def delete(self, id: str) -> None:
        """Delete entry by id. Raises KeyError if not found."""
        path = self._entry_path(id)
        if not path.exists():
            raise KeyError(f"Entry not found: {id}")
        await asyncio.to_thread(path.unlink)
