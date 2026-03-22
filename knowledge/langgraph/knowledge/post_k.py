"""Post-Knowledge verification -- ported from clab-platform post-k.ts."""

from __future__ import annotations

from langgraph.knowledge.services.integrity_checker import check_integrity
from langgraph.knowledge.types import DebtSummary, PostKnowledgeDebt


async def verify_post_knowledge(
    modified_docs: list[str],
    base_path: str,
    mission_id: str | None = None,
) -> PostKnowledgeDebt:
    """Verify knowledge integrity after task execution.

    1. Run integrity check on modified docs
    2. Build summary: count by debt type
    3. Return PostKnowledgeDebt with pass/fail, debts, summary
    """

    passed, debts = await check_integrity(modified_docs, base_path)

    summary = DebtSummary(
        total=len(debts),
        missing_crosslinks=sum(1 for d in debts if d.type == "missing_crosslink"),
        missing_hub=sum(1 for d in debts if d.type == "missing_hub"),
        orphan_docs=sum(1 for d in debts if d.type == "orphan_doc"),
        broken_links=sum(1 for d in debts if d.type == "broken_link"),
        stale_docs=sum(1 for d in debts if d.type == "stale_doc"),
    )

    return PostKnowledgeDebt(
        passed=passed,
        debts=debts,
        summary=summary,
        mission_id=mission_id,
    )
