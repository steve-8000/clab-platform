"""Planner node: decomposes a goal into a task list using Claude CLI."""
from __future__ import annotations
import json
import re
import logging

from graph.state import AgentState

logger = logging.getLogger(__name__)

PLANNER_SYSTEM_PROMPT = """You are a development planner. Given a goal and context, decompose it into concrete executable tasks.

Output ONLY a JSON array of tasks (no other text):
[
  {"id": "1", "title": "short title", "description": "detailed prompt for Claude/Codex CLI", "engine": "claude|codex"},
  ...
]

Rules:
- Each task should be independently executable by a CLI tool
- Always create at least 3 tasks for non-trivial goals
- Use "codex" engine for ALL tasks (code generation, implementation, verification)
- Never use "claude" engine — all work goes through codex
- Each task description must be self-contained and include all context needed
- Tasks in the same wave should be independent of each other
- Order tasks by dependency (earlier tasks first)
- Keep tasks focused — one clear objective each
- Include test/verification tasks when appropriate
"""

async def planner_node(state: AgentState) -> dict:
    """Decompose goal into task list using Claude CLI."""
    from local_agent.config import invoke_cli

    raw_context = state.get("enriched_context", "") or "No prior context."
    context = raw_context[:2000] if len(raw_context) > 2000 else raw_context
    user_prompt = f"Goal: {state['goal']}\n\nContext:\n{context}"

    response = await invoke_cli(PLANNER_SYSTEM_PROMPT, user_prompt, timeout=600)
    logger.info("Planner response length: %d chars", len(response))

    tasks = _parse_tasks(response)
    logger.info("Planned %d tasks", len(tasks))

    return {
        "plan": tasks,
        "current_task_index": 0,
    }

def _parse_tasks(content: str) -> list:
    """Extract JSON task array from CLI response."""
    match = re.search(r'\[[\s\S]*\]', content)
    if match:
        try:
            raw = json.loads(match.group())
            return [
                {
                    "id": str(t.get("id", i+1)),
                    "title": t.get("title", ""),
                    "description": t.get("description", ""),
                    "engine": "codex",
                    "status": "pending",
                    "result": "",
                    "attempt": 0,
                }
                for i, t in enumerate(raw)
            ]
        except json.JSONDecodeError:
            pass
    return [{
        "id": "1",
        "title": "Execute goal",
        "description": content,
        "engine": "codex",
        "status": "pending",
        "result": "",
        "attempt": 0,
    }]
