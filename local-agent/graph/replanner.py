"""Replanner node: adjusts the plan when a task fails, using Claude CLI."""
from __future__ import annotations
import json
import re
import logging

logger = logging.getLogger(__name__)

REPLANNER_PROMPT = """You are a development replanner. A task has failed.

Given the original plan, the failed task, and the error output, decide:
1. RETRY - same task with a modified prompt (fix the approach)
2. SKIP - skip this task and continue
3. ABORT - the goal cannot be achieved

Respond with ONLY JSON (no other text):
{"action": "retry|skip|abort", "reason": "...", "modified_description": "..." (for retry only)}
"""

async def replanner_node(state: dict) -> dict:
    """Re-evaluate and adjust plan after a task failure."""
    from local_agent.config import invoke_cli

    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)
    task = plan[idx] if idx < len(plan) else {}
    max_retries = state.get("max_retries", 3)

    if task.get("attempt", 0) >= max_retries:
        plan[idx] = {**task, "status": "failed"}
        return {
            "plan": plan,
            "current_task_index": idx + 1,
            "failed_tasks": state.get("failed_tasks", []) + [task],
        }

    current_output = state.get("current_output", "")[:2000]
    verification_result = state.get("verification_result", "")

    user_prompt = (
        f"Plan: {json.dumps(plan, indent=2)}\n\n"
        f"Failed task: {json.dumps(task)}\n\n"
        f"Error output:\n{current_output}\n\n"
        f"Verification:\n{verification_result}"
    )

    response = await invoke_cli(REPLANNER_PROMPT, user_prompt)

    match = re.search(r'\{[\s\S]*\}', response)
    decision = {"action": "skip"}
    if match:
        try:
            decision = json.loads(match.group())
        except json.JSONDecodeError:
            pass

    action = decision.get("action", "skip")
    logger.info("Replanner decision: %s — %s", action, decision.get("reason", ""))

    if action == "retry" and decision.get("modified_description"):
        plan[idx] = {**task, "description": decision["modified_description"], "status": "pending"}
        return {"plan": plan}
    elif action == "abort":
        for i in range(idx, len(plan)):
            plan[i] = {**plan[i], "status": "skipped"}
        return {"plan": plan, "current_task_index": len(plan)}
    else:
        plan[idx] = {**task, "status": "failed"}
        return {
            "plan": plan,
            "current_task_index": idx + 1,
            "failed_tasks": state.get("failed_tasks", []) + [task],
        }
