"""LangGraph node: extract insights from task results."""

from __future__ import annotations

import dataclasses

from langgraph.knowledge.insights import TaskResult, extract_insights
from langgraph.knowledge.local_store import LocalKnowledgeStore


async def insight_node(state: dict, config: dict | None = None) -> dict:
    """Extract insights from task results and persist them.

    Reads from state:
      - `task_run_id` (str): identifier for the task run
      - `task_result` (dict): must have keys: status, summary.
        Optional keys: changed_files, risks, followups
      - `task_context` (str, optional): additional context about the task
      - `knowledge_store_dir` (str, optional): defaults to ".knowledge-data"

    Writes to state:
      - `insights` (list[dict]): extracted insights as dicts
      - `insight_count` (int): number of insights extracted
    """

    task_run_id: str = state.get("task_run_id", "unknown")
    raw_result: dict = state.get("task_result", {})
    task_context: str = state.get("task_context", "")
    store_dir: str = state.get("knowledge_store_dir", ".knowledge-data")

    # Build TaskResult from dict, handling missing keys gracefully
    result = TaskResult(
        status=raw_result.get("status", "unknown"),
        summary=raw_result.get("summary", ""),
        changed_files=raw_result.get("changed_files", []),
        risks=raw_result.get("risks", []),
        followups=raw_result.get("followups", []),
    )

    store = LocalKnowledgeStore(store_dir)
    insights = await extract_insights(task_run_id, result, task_context, store)

    return {
        "insights": [dataclasses.asdict(i) for i in insights],
        "insight_count": len(insights),
    }
