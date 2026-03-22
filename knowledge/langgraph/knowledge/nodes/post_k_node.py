"""LangGraph node: verify knowledge integrity after task execution."""

from __future__ import annotations

import dataclasses

from langgraph.knowledge.post_k import verify_post_knowledge
from langgraph.knowledge.types import PostKnowledgeDebt


async def post_k_node(state: dict, config: dict | None = None) -> dict:
    """Verify knowledge integrity after task execution.

    Reads from state:
      - `modified_docs` (list[str]): paths of docs modified during task
      - `base_path` (str, optional): base path for integrity check, defaults to "."
      - `mission_id` (str, optional): mission identifier

    Writes to state:
      - `post_knowledge` (dict): PostKnowledgeDebt as dict
      - `knowledge_debt_passed` (bool): whether integrity check passed
    """

    modified_docs: list[str] = state.get("modified_docs", [])
    base_path: str = state.get("base_path", ".")
    mission_id: str | None = state.get("mission_id")

    result: PostKnowledgeDebt = await verify_post_knowledge(
        modified_docs, base_path, mission_id
    )

    return {
        "post_knowledge": dataclasses.asdict(result),
        "knowledge_debt_passed": result.passed,
    }
