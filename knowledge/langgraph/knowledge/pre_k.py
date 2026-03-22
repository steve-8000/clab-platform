"""Pre-Knowledge retrieval -- ported from clab-platform pre-k.ts."""

from __future__ import annotations

from langgraph.knowledge.services.doc_searcher import search_docs
from langgraph.knowledge.services.keyword_extractor import extract_keywords
from langgraph.knowledge.store import KnowledgeStore
from langgraph.knowledge.types import PreKnowledgeEntry, PreKnowledgeResult


async def retrieve_pre_knowledge(
    task_description: str,
    role_id: str,
    store: KnowledgeStore,
    scope_paths: list[str] | None = None,
) -> PreKnowledgeResult:
    """Retrieve prior knowledge relevant to a task before execution.

    1. Extract keywords from task description (max 8)
    2. Search knowledge store for each keyword (top 3 per keyword)
    3. Deduplicate, compute relevance = matched_keywords / total_keywords
    4. Sort by relevance desc, take top 5
    5. Search project docs in scope_paths (if provided)
    6. Generate warnings:
       - Duplicate risk if any entry has relevance > 0.6
       - Related docs warning if project docs found
    7. Compute total chars
    8. Return PreKnowledgeResult
    """

    # 1. Extract keywords
    keywords = extract_keywords(task_description, max_count=8)

    # 2. Search knowledge store for matching entries
    knowledge_entries: list[PreKnowledgeEntry] = []
    seen_ids: set[str] = set()

    for kw in keywords:
        matches = await store.search(kw, limit=3)
        for entry in matches:
            if entry.id in seen_ids:
                continue
            seen_ids.add(entry.id)

            excerpt = entry.content[:300]
            matched_count = sum(
                1
                for k in keywords
                if k in entry.content.lower() or k in entry.topic.lower()
            )
            relevance = matched_count / len(keywords) if keywords else 0.0

            knowledge_entries.append(
                PreKnowledgeEntry(
                    id=entry.id,
                    topic=entry.topic,
                    excerpt=excerpt,
                    relevance=relevance,
                )
            )

    # 3. Sort by relevance desc, take top 5
    knowledge_entries.sort(key=lambda e: e.relevance, reverse=True)
    top_entries = knowledge_entries[:5]

    # 4. Search project docs in scope paths
    scope = scope_paths or []
    project_docs = (
        await search_docs(keywords, scope, max_results=5, max_total_chars=2000)
        if scope
        else []
    )

    # 5. Warnings
    warnings: list[str] = []

    high_relevance = [e for e in top_entries if e.relevance > 0.6]
    if high_relevance:
        warnings.append(
            f"Duplicate risk: {len(high_relevance)} existing knowledge entries "
            "closely match this task. Review before creating new docs."
        )

    if project_docs:
        warnings.append(
            f"{len(project_docs)} related project doc(s) found. "
            "Check for overlap before modifying."
        )

    # 6. Compute total chars
    total_chars = sum(len(e.excerpt) for e in top_entries) + sum(
        len(d.excerpt) for d in project_docs
    )

    return PreKnowledgeResult(
        keywords=keywords,
        knowledge_entries=top_entries,
        project_docs=project_docs,
        warnings=warnings,
        total_chars=total_chars,
    )
