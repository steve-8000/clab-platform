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
        ws_id = await runtime.create_agent(f"{role}-{goal}", workdir=workdir)
        state["cmux_workspace_id"] = ws_id

    # Get or create surface for this engine (reused across tasks)
    engine_initialized = state.get("_engine_initialized", set())
    surface_id = await runtime.get_or_create_surface(engine)

    # Start engine only on first use (cd + launch CLI)
    if engine not in engine_initialized:
        await runtime.start_engine(surface_id, engine, workdir, system_prompt=enriched_context)
        engine_initialized.add(engine)
        state["_engine_initialized"] = engine_initialized

    # Inject task instruction into the engine's surface
    await runtime.inject_command(engine, task["description"])

    # Collect output (raw — no success/failure judgment)
    result = await runtime.collect_output(engine, timeout=300, task_id=task_id)

    # Signal completion (trigger only — clab review decides actual status)
    task_title = task.get("title", task_id)
    await runtime.signal_completion(engine, task_title, result.output[-100:] if result.output else "")

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

    # Guard: stop if max iterations exceeded
    if state.get("iteration_count", 0) >= state.get("max_iterations", 20):
        return {"current_output": "Max iterations reached", "current_exit_code": 1}

    if idx >= len(plan):
        return {"current_output": "", "current_exit_code": -1}

    task = plan[idx]
    logger.info("Executing task %s: %s (%s)", task["id"], task["title"], task.get("engine", "claude"))

    # Report task start to Control Plane
    reporter = state.get("_cp_reporter")
    if reporter:
        try:
            await reporter.report_task_start(task.get("title", task["id"]), idx)
        except Exception:
            pass

    runtime = await _get_cmux_runtime()
    if runtime:
        result = await _execute_via_cmux(runtime, state, task)
    else:
        result = await _execute_via_subprocess(state, task)

    # Report task completion to Control Plane
    if reporter:
        try:
            await reporter.report_task_complete(
                task.get("title", task["id"]),
                result.get("current_output", "")[:2000],
            )
        except Exception:
            pass

    return result



# ---- Parallel execution support ----

_cmux_worker_pool = None


async def _get_or_create_worker_pool(runtime, state: dict):
    """Lazily create worker pool on first parallel execution."""
    global _cmux_worker_pool
    if _cmux_worker_pool is not None:
        return _cmux_worker_pool

    workdir = state.get("workdir", ".")
    enriched_context = state.get("enriched_context", "")
    pool = await runtime.create_worker_pool(
        num_workers=3, workdir=workdir, system_prompt=enriched_context
    )
    _cmux_worker_pool = pool
    return pool


async def parallel_executor_node(state: dict) -> dict:
    """Execute up to N pending tasks in parallel via WorkerPool.

    Falls back to sequential executor_node when cmux/WorkerPool unavailable.
    """
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    # Collect pending tasks from current index (max 3)
    pending_tasks = []
    pending_indices = []
    for i in range(idx, len(plan)):
        if plan[i].get("status") == "pending":
            pending_tasks.append(plan[i])
            pending_indices.append(i)
        if len(pending_tasks) >= 3:
            break

    if not pending_tasks:
        return {"current_output": "", "current_exit_code": -1}

    runtime = await _get_cmux_runtime()
    if not runtime:
        return await executor_node(state)

    # Ensure workspace exists
    if not state.get("cmux_workspace_id"):
        from local_agent.cmux.bootstrap import ProjectBootstrapper
        workdir = state.get("workdir", ".")
        await ProjectBootstrapper().provision(workdir)
        goal = state.get("goal", "mission")[:30]
        role = state.get("role_id", "agent")
        ws_id = await runtime.create_agent(f"{role}-{goal}", workdir=workdir)
        state["cmux_workspace_id"] = ws_id

    # Report batch start to Control Plane
    reporter = state.get("_cp_reporter")
    if reporter:
        try:
            titles = ", ".join(t.get("title", t["id"]) for t in pending_tasks)
            await reporter.report_task_start(f"Batch: {titles[:100]}", idx)
        except Exception:
            pass

    try:
        pool = await _get_or_create_worker_pool(runtime, state)
        results = await pool.execute_batch(pending_tasks, timeout=300)
    except Exception as exc:
        logger.error("Parallel execution failed, falling back to sequential: %s", exc)
        return await executor_node(state)

    # Report batch completion to Control Plane
    if reporter:
        try:
            for task, result in zip(pending_tasks, results):
                await reporter.report_task_complete(
                    task.get("title", task["id"]),
                    result.output[:2000] if result.output else "",
                )
        except Exception:
            pass

    # Update plan with results
    surface_map = state.get("surface_map", {})
    combined_output = []
    all_idle = True

    for task, result, plan_idx in zip(pending_tasks, results, pending_indices):
        task_id = task["id"]
        plan[plan_idx] = {
            **task,
            "status": "running",
            "attempt": task["attempt"] + 1,
            "result": result.output[-500:] if result.output else "",
        }
        surface_map[task_id] = result.surface_id
        combined_output.append(
            f"=== Task {task_id}: {task.get('title', '')} ===\n{result.output[-1000:]}"
        )
        if not result.idle_detected:
            all_idle = False

    return {
        "current_output": "\n\n".join(combined_output),
        "current_exit_code": 0 if all_idle else 124,
        "plan": plan,
        "cmux_workspace_id": state.get("cmux_workspace_id", ""),
        "surface_map": surface_map,
        "current_task_index": max(pending_indices) + 1 if pending_indices else idx,
    }
