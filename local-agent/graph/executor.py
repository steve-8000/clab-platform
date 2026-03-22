"""Executor node: runs Claude or Codex CLI via subprocess."""
from __future__ import annotations
import asyncio
import time
import logging

logger = logging.getLogger(__name__)

async def executor_node(state: dict) -> dict:
    """Execute the current task using Claude/Codex CLI subprocess."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    if idx >= len(plan):
        return {"current_output": "", "current_exit_code": -1}

    task = plan[idx]
    engine = task.get("engine", "claude")
    prompt = task["description"]
    workdir = state.get("workdir", ".")

    # Enrich prompt with context
    if state.get("enriched_context"):
        prompt = f"{state['enriched_context']}\n\n---\n\n{prompt}"

    # Build CLI command
    if engine == "claude":
        cmd = ["claude", "--print", "-p", prompt]
    elif engine == "codex":
        cmd = ["codex", "--quiet", "-p", prompt]
    else:
        return {"current_output": f"Unknown engine: {engine}", "current_exit_code": 1}

    logger.info(f"Executing task {task['id']}: {task['title']} ({engine})")
    start = time.monotonic()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        duration_ms = int((time.monotonic() - start) * 1000)

        output = stdout.decode("utf-8", errors="replace")
        if proc.returncode != 0:
            output += f"\n\nSTDERR:\n{stderr.decode('utf-8', errors='replace')}"

        logger.info(f"Task {task['id']}: exit={proc.returncode} ({duration_ms}ms)")

        # Update task in plan
        plan[idx] = {**task, "status": "running", "attempt": task["attempt"] + 1}

        return {
            "current_output": output,
            "current_exit_code": proc.returncode or 0,
            "plan": plan,
        }
    except asyncio.TimeoutError:
        return {"current_output": "Timeout after 300s", "current_exit_code": 124}
    except FileNotFoundError:
        return {"current_output": f"{engine} CLI not found", "current_exit_code": 127}
