"""LangGraph node: enrich state with prior knowledge before task execution."""

from __future__ import annotations

import dataclasses

from langgraph.knowledge.local_store import LocalKnowledgeStore
from langgraph.knowledge.pre_k import retrieve_pre_knowledge
from langgraph.knowledge.types import PreKnowledgeResult


async def pre_k_node(state: dict, config: dict | None = None) -> dict:
    """Retrieve prior knowledge and inject into state.

    Reads from state:
      - `task_description` (str): what the task is about
      - `role_id` (str, optional): role performing the task, defaults to "BUILDER"
      - `knowledge_store_dir` (str, optional): path to knowledge store,
        defaults to ".knowledge-data"
      - `scope_paths` (list[str], optional): paths to search for project docs

    Writes to state:
      - `pre_knowledge` (dict): the PreKnowledgeResult as dict
      - `enriched_context` (str): formatted context string ready for LLM injection

    The enriched_context format::

        ## Prior Knowledge
        ### From Knowledge Base
        - [topic]: excerpt...
        ### From Project Docs
        - [path]: excerpt...
        ### Warnings
        - warning text...
    """

    task_description: str = state.get("task_description", "")
    role_id: str = state.get("role_id", "BUILDER")
    store_dir: str = state.get("knowledge_store_dir", ".knowledge-data")
    scope_paths: list[str] = state.get("scope_paths", [])

    store = LocalKnowledgeStore(store_dir)
    result: PreKnowledgeResult = await retrieve_pre_knowledge(
        task_description, role_id, store, scope_paths
    )

    # Format enriched context
    lines: list[str] = ["## Prior Knowledge"]

    if result.knowledge_entries:
        lines.append("### From Knowledge Base")
        for entry in result.knowledge_entries:
            lines.append(f"- [{entry.topic}]: {entry.excerpt}")

    if result.project_docs:
        lines.append("### From Project Docs")
        for doc in result.project_docs:
            lines.append(f"- [{doc.path}]: {doc.excerpt}")

    if result.warnings:
        lines.append("### Warnings")
        for w in result.warnings:
            lines.append(f"- {w}")

    enriched: str = "\n".join(lines) if len(lines) > 1 else ""

    return {
        "pre_knowledge": dataclasses.asdict(result),
        "enriched_context": enriched,
    }
