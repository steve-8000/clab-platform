"""Shared types for the knowledge layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class KnowledgeEntry:
    """A single knowledge entry stored in the knowledge store."""

    id: str
    topic: str
    content: str
    tags: list[str] = field(default_factory=list)
    source: Literal["MANUAL", "EXTRACTED", "DISTILLED"] = "MANUAL"
    confidence: float = 1.0
    created_at: str = ""
    updated_at: str | None = None
    mission_id: str | None = None


@dataclass
class SearchResult:
    """Result from a project-doc search."""

    path: str
    relevance_score: int
    excerpt: str
    matched_keywords: list[str] = field(default_factory=list)


@dataclass
class PreKnowledgeEntry:
    """A deduplicated knowledge entry with relevance score."""

    id: str
    topic: str
    excerpt: str
    relevance: float


@dataclass
class PreKnowledgeResult:
    """Result of pre-knowledge retrieval for a task."""

    keywords: list[str]
    knowledge_entries: list[PreKnowledgeEntry] = field(default_factory=list)
    project_docs: list[SearchResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    total_chars: int = 0


@dataclass
class DebtItem:
    """A single knowledge-debt finding."""

    type: Literal[
        "missing_crosslink",
        "missing_hub",
        "orphan_doc",
        "broken_link",
        "stale_doc",
    ]
    path: str
    description: str


@dataclass
class DebtSummary:
    """Aggregated counts by debt type."""

    total: int = 0
    missing_crosslinks: int = 0
    missing_hub: int = 0
    orphan_docs: int = 0
    broken_links: int = 0
    stale_docs: int = 0


@dataclass
class PostKnowledgeDebt:
    """Result of post-knowledge integrity verification."""

    passed: bool
    debts: list[DebtItem] = field(default_factory=list)
    summary: DebtSummary = field(default_factory=DebtSummary)
    mission_id: str | None = None


@dataclass
class StoreStatus:
    """Status summary of the knowledge store."""

    total_entries: int = 0
    unique_topics: int = 0
    last_updated: str | None = None
