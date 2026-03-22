"""Planner node: decomposes a goal into a task graph using the orchestrator LLM."""
from __future__ import annotations
import json
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

PLANNER_SYSTEM_PROMPT = """You are a development planner. Given a goal and context, decompose it into concrete executable tasks.

Output a JSON array of tasks:
[
  {"id": "1", "title": "short title", "description": "detailed prompt for Claude/Codex CLI", "engine": "claude|codex"},
  ...
]

Rules:
- Each task should be independently executable by a CLI tool
- "claude" for complex reasoning, code review, architecture decisions
- "codex" for straightforward code generation, implementation
- Order tasks by dependency (earlier tasks first)
- Keep tasks focused — one clear objective each
- Include test/verification tasks when appropriate
"""

async def planner_node(state: dict) -> dict:
    """Decompose goal into task list using LLM."""
    from local_agent.config import get_model

    model = get_model()

    context_parts = []
    if state.get("enriched_context"):
        context_parts.append(state["enriched_context"])

    messages = [
        SystemMessage(content=PLANNER_SYSTEM_PROMPT),
        HumanMessage(content=f"Goal: {state['goal']}\n\nContext:\n{chr(10).join(context_parts) if context_parts else 'No prior context.'}")
    ]

    response = await model.ainvoke(messages)

    # Parse task list from response
    tasks = _parse_tasks(response.content)

    return {
        "plan": tasks,
        "current_task_index": 0,
        "messages": [response],
    }

def _parse_tasks(content: str) -> list:
    """Extract JSON task array from LLM response."""
    # Try to find JSON array in response
    import re
    match = re.search(r'\[[\s\S]*\]', content)
    if match:
        try:
            raw = json.loads(match.group())
            return [
                {
                    "id": str(t.get("id", i+1)),
                    "title": t.get("title", ""),
                    "description": t.get("description", ""),
                    "engine": t.get("engine", "claude"),
                    "status": "pending",
                    "result": "",
                    "attempt": 0,
                }
                for i, t in enumerate(raw)
            ]
        except json.JSONDecodeError:
            pass
    # Fallback: single task
    return [{
        "id": "1",
        "title": "Execute goal",
        "description": content,
        "engine": "claude",
        "status": "pending",
        "result": "",
        "attempt": 0,
    }]
