"""Insight extraction from task results -- ported from clab-platform insights.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from langgraph.knowledge.services.keyword_extractor import extract_keywords
from langgraph.knowledge.store import KnowledgeStore
from langgraph.knowledge.types import KnowledgeEntry


@dataclass
class TaskResult:
    """Describes the outcome of a task run."""

    status: str
    summary: str
    changed_files: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    followups: list[str] = field(default_factory=list)


@dataclass
class ExtractedInsight:
    """A single insight extracted from a task run."""

    id: str
    task_run_id: str
    type: str  # "pattern" | "decision" | "risk" | "learning"
    title: str
    description: str
    evidence: list[str]
    tags: list[str]
    created_at: str


DECISION_INDICATORS: list[str] = [
    "decided",
    "chose",
    "selected",
    "opted",
    "switched",
    "migrated",
    "replaced",
    "adopted",
]


async def extract_insights(
    task_run_id: str,
    result: TaskResult,
    context: str,
    store: KnowledgeStore,
) -> list[ExtractedInsight]:
    """Extract insights from a task run result and store them.

    1. Pattern detection: extract keywords, if >= 3 keywords -> create pattern insight
    2. Decision detection: check summary for decision indicator words -> create decision insight
    3. Risk detection: if result.risks is non-empty -> create risk insight
    4. Store each insight as a knowledge entry (source=EXTRACTED, confidence=0.8)
    5. Return list of extracted insights
    """

    extracted: list[ExtractedInsight] = []
    combined_text = f"{result.summary} {context}"

    # 1. Pattern detection
    keywords = extract_keywords(combined_text, max_count=6)

    if len(keywords) >= 3:
        now = datetime.now(tz=timezone.utc).isoformat()
        extracted.append(
            ExtractedInsight(
                id=str(uuid4()),
                task_run_id=task_run_id,
                type="pattern",
                title=f"Pattern: {', '.join(keywords[:3])}",
                description=f"Recurring themes detected in task output: {', '.join(keywords)}",
                evidence=[result.summary[:500]],
                tags=keywords,
                created_at=now,
            )
        )

    # 2. Decision detection
    summary_lower = result.summary.lower()
    has_decision = any(ind in summary_lower for ind in DECISION_INDICATORS)

    if has_decision:
        now = datetime.now(tz=timezone.utc).isoformat()
        extracted.append(
            ExtractedInsight(
                id=str(uuid4()),
                task_run_id=task_run_id,
                type="decision",
                title=f"Decision recorded from task {task_run_id}",
                description=result.summary[:500],
                evidence=[result.summary[:500]],
                tags=["decision", *keywords[:3]],
                created_at=now,
            )
        )

    # 3. Risk detection
    if result.risks:
        now = datetime.now(tz=timezone.utc).isoformat()
        extracted.append(
            ExtractedInsight(
                id=str(uuid4()),
                task_run_id=task_run_id,
                type="risk",
                title=f"{len(result.risks)} risk(s) identified",
                description="; ".join(result.risks),
                evidence=list(result.risks),
                tags=["risk", *keywords[:2]],
                created_at=now,
            )
        )

    # 4. Store each insight as a knowledge entry
    for insight in extracted:
        now = datetime.now(tz=timezone.utc).isoformat()
        entry = KnowledgeEntry(
            id=str(uuid4()),
            topic=insight.title,
            content=insight.description,
            tags=insight.tags,
            source="EXTRACTED",
            confidence=0.8,
            created_at=now,
        )
        await store.store(entry)

    return extracted
