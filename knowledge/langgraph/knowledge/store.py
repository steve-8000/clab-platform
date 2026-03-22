"""Abstract knowledge store protocol."""

from __future__ import annotations

from typing import Protocol

from langgraph.knowledge.types import KnowledgeEntry, StoreStatus


class KnowledgeStore(Protocol):
    """Protocol that any knowledge-store backend must satisfy."""

    async def store(self, entry: KnowledgeEntry) -> KnowledgeEntry: ...

    async def search(
        self, query: str, *, limit: int = 10
    ) -> list[KnowledgeEntry]: ...

    async def get_by_topic(self, topic: str) -> list[KnowledgeEntry]: ...

    async def get_by_tags(self, tags: list[str]) -> list[KnowledgeEntry]: ...

    async def status(self) -> StoreStatus: ...

    async def delete(self, id: str) -> None: ...
