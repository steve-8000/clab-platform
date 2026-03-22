"""Executor node: runs tasks via cmux runtime (preferred) or CLI subprocess (fallback)."""
from __future__ import annotations
import asyncio
import shutil
import time
import logging

logger = logging.getLogger(__name__)

# Lazy-loaded cmux runtime (shared across invocations within a graph run)
_cmux_runtime = None


async def _get_cmux_runtime():
    """Get or create a shared CmuxRuntime instance. Returns None if cmux unavailable."""
    global _cmux_runtime
    if _cmux_runtime is not None:
        return _cmux_runtime

    if not shutil.which("cmux"):
        logger.info("cmux not found in PATH — using subprocess fallback")
        return None

    try:
        from local_agent.cmux import CmuxClient, CmuxRuntime
        client = CmuxClient()
        await client.connect()
        _cmux_runtime = CmuxRuntime(client)
        logger.info("cmux runtime initialized")
        return _cmux_runtime
    except Exception as exc:
        logger.warning("cmux connection failed, falling back to subprocess: %s", exc)
        return None


async def _execute_via_cmux(runtime, state: dict, task: dict) -> dict:
    """Execute task using CmuxRuntime. Returns raw output for clab to judge."""
    workdir = state.get("workdir", ".")
    enriched_context = state.get("enriched_context", "")
    task_id = task["id"]
    engine = task.get("engine", "claude")

    # Create agent workspace + bootstrap project config if not yet done
    if not state.get("cmux_workspace_id"):
        from local_agent.cmux.bootstrap import ProjectBootstrapper
        await ProjectBootstrapper().provision(workdir)
        goal = state.get("goal", "mission")[:30]
        role = state.get("role_id", "agent")
        ws_id = await runtime.create_agent(f"{role}-{goal}")
        state["cmux_workspace_id"] = ws_id

    # Allocate surface for this task
    surface_id = await runtime.allocate_surface(engine, task_id=task_id)

    # Start engine (cd + launch CLI)
    await runtime.start_engine(surface_id, engine, workdir, system_prompt=enriched_context)

    # Inject task instruction
    await runtime.inject_command(task_id, task["description"])

    # Collect output (raw — no success/failure judgment)
    result = await runtime.collect_output(task_id, timeout=300)

    # Signal completion (trigger only — clab review decides actual status)
    await runtime.signal_completion(task_id, result.output[-100:] if result.output else "")

    # Update surface_map in state
    surface_map = state.get("surface_map", {})
    surface_map[task_id] = surface_id
    state["surface_map"] = surface_map

    # Update plan status to "running"
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)
    if idx < len(plan):
        plan[idx] = {**task, "status": "running", "attempt": task["attempt"] + 1}

    return {
        "current_output": result.output,
        "current_exit_code": 0 if result.idle_detected else 124,
        "plan": plan,
        "cmux_workspace_id": state.get("cmux_workspace_id", ""),
        "surface_map": surface_map,
    }


async def _execute_via_subprocess(state: dict, task: dict) -> dict:
    """Fallback: execute via CLI subprocess (original behavior)."""
    engine = task.get("engine", "claude")
    prompt = task["description"]
    workdir = state.get("workdir", ".")

    if state.get("enriched_context"):
        prompt = f"{state['enriched_context']}\n\n---\n\n{prompt}"

    if engine == "claude":
        cmd = ["claude", "--print", "-p", prompt]
    elif engine == "codex":
        cmd = ["codex", "--quiet", "-p", prompt]
    else:
        return {"current_output": f"Unknown engine: {engine}", "current_exit_code": 1}

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

        logger.info("Task %s: exit=%s (%dms)", task["id"], proc.returncode, duration_ms)

        plan = state.get("plan", [])
        idx = state.get("current_task_index", 0)
        if idx < len(plan):
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


async def executor_node(state: dict) -> dict:
    """Execute the current task — cmux runtime preferred, subprocess fallback."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    if idx >= len(plan):
        return {"current_output": "", "current_exit_code": -1}

    task = plan[idx]
    logger.info("Executing task %s: %s (%s)", task["id"], task["title"], task.get("engine", "claude"))

    runtime = await _get_cmux_runtime()
    if runtime:
        return await _execute_via_cmux(runtime, state, task)
    else:
        return await _execute_via_subprocess(state, task)
