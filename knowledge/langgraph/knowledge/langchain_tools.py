"""LangChain tools wrapping the knowledge layer for use in LLM agents."""

from __future__ import annotations

import dataclasses
import json


from langchain_core.tools import tool

from langgraph.knowledge.local_store import LocalKnowledgeStore
from langgraph.knowledge.types import KnowledgeEntry
from langgraph.knowledge.services.keyword_extractor import extract_keywords
from langgraph.knowledge.pre_k import retrieve_pre_knowledge
from langgraph.knowledge.post_k import verify_post_knowledge
from langgraph.knowledge.insights import extract_insights, TaskResult

# Module-level store instance, configurable
_store: LocalKnowledgeStore | None = None
_store_dir: str = ".knowledge-data"


def get_store() -> LocalKnowledgeStore:
    global _store
    if _store is None:
        _store = LocalKnowledgeStore(_store_dir)
    return _store


def configure_store(directory: str) -> None:
    """Configure the knowledge store directory. Call before using tools."""
    global _store, _store_dir
    _store_dir = directory
    _store = None  # reset so next get_store() creates fresh


@tool
async def knowledge_search(query: str, limit: int = 10) -> str:
    """Search the knowledge base for entries matching a query.
    Use this to find prior knowledge, decisions, patterns, and insights.

    Args:
        query: Search query (keywords)
        limit: Maximum results to return
    """
    store = get_store()
    results = await store.search(query, limit=limit)
    if not results:
        return "No knowledge entries found."
    entries = [
        {
            "topic": r.topic,
            "content": r.content[:200],
            "tags": r.tags,
            "confidence": r.confidence,
        }
        for r in results
    ]
    return json.dumps(entries, indent=2, ensure_ascii=False)


@tool
async def knowledge_store_entry(
    topic: str, content: str, tags: str = "", source: str = "MANUAL"
) -> str:
    """Store a new knowledge entry in the knowledge base.
    Use this to save decisions, patterns, insights, or learnings for future reference.

    Args:
        topic: Short title for the knowledge entry
        content: Detailed content of the knowledge
        tags: Comma-separated tags (e.g. "architecture,decision,api")
        source: Source type - MANUAL, EXTRACTED, or DISTILLED
    """
    from datetime import datetime, timezone
    from uuid import uuid4

    store = get_store()
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    now = datetime.now(tz=timezone.utc).isoformat()

    entry = KnowledgeEntry(
        id=str(uuid4()),
        topic=topic,
        content=content,
        tags=tag_list,
        source=source,
        confidence=1.0,
        created_at=now,
    )
    await store.store(entry)
    return f"Stored knowledge entry: {entry.id} ({topic})"


@tool
async def knowledge_pre_k(
    task_description: str, role_id: str = "BUILDER", scope_paths: str = ""
) -> str:
    """Retrieve prior knowledge relevant to a task BEFORE starting work.
    This searches the knowledge base and project docs for context.

    Args:
        task_description: Description of the task to be performed
        role_id: Role performing the task (BUILDER, ARCHITECT, PM, etc.)
        scope_paths: Comma-separated paths to search for project docs
    """
    store = get_store()
    paths = (
        [p.strip() for p in scope_paths.split(",") if p.strip()]
        if scope_paths
        else []
    )
    result = await retrieve_pre_knowledge(task_description, role_id, store, paths)

    lines = []
    if result.knowledge_entries:
        lines.append("## Prior Knowledge")
        for e in result.knowledge_entries:
            lines.append(
                f"- **{e.topic}** (relevance: {e.relevance:.0%}): {e.excerpt}"
            )
    if result.project_docs:
        lines.append("## Related Project Docs")
        for d in result.project_docs:
            lines.append(f"- [{d.path}]: {d.excerpt[:100]}...")
    if result.warnings:
        lines.append("## Warnings")
        for w in result.warnings:
            lines.append(f"- {w}")

    return "\n".join(lines) if lines else "No prior knowledge found for this task."


@tool
async def knowledge_post_k(modified_docs: str, base_path: str = ".") -> str:
    """Verify knowledge integrity AFTER completing work.
    Checks for broken links, missing crosslinks, orphan docs, etc.

    Args:
        modified_docs: Comma-separated paths of modified documents
        base_path: Base directory for integrity check
    """
    doc_list = [d.strip() for d in modified_docs.split(",") if d.strip()]
    if not doc_list:
        return "No documents to check."

    result = await verify_post_knowledge(doc_list, base_path)

    if result.passed:
        return "Knowledge integrity check PASSED. No issues found."

    lines = [f"Knowledge integrity check FAILED. {result.summary.total} issue(s):"]
    for debt in result.debts:
        lines.append(f"- [{debt.type}] {debt.path}: {debt.description}")
    return "\n".join(lines)


def get_knowledge_tools() -> list:
    """Return all knowledge tools for use in LangChain agents."""
    return [knowledge_search, knowledge_store_entry, knowledge_pre_k, knowledge_post_k]
