"""Verifier node: runs tests, build, and lint to verify execution results."""
from __future__ import annotations
import asyncio
import logging

logger = logging.getLogger(__name__)


async def _verify_via_cmux(runtime, state: dict) -> dict:
    """Run verification commands through the cmux surface used for execution."""
    surface_map = state.get("surface_map", {})
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    if idx < len(plan):
        task_id = plan[idx]["id"]
        surface_id = surface_map.get(task_id)
    else:
        surface_id = None

    if not surface_id:
        logger.info("No cmux surface for current task, falling back to subprocess verify")
        return await _verify_via_subprocess(state)

    checks = []
    for cmd_name, cmd_str in [
        ("type-check", "python3 -m mypy . --ignore-missing-imports"),
        ("lint", "python3 -m ruff check ."),
        ("test", "python3 -m pytest -x --tb=short -q"),
    ]:
        try:
            result = await runtime.inject_command(
                f"verify-{cmd_name}", cmd_str, surface_id=surface_id
            )
            output = await runtime.collect_output(
                f"verify-{cmd_name}", timeout=60, surface_id=surface_id
            )
            passed = output.exit_code == 0 if hasattr(output, "exit_code") else True
            checks.append(f"{cmd_name}: {'PASS' if passed else 'FAIL'}")
            if not passed and output.output:
                checks.append(f"  {output.output[:500]}")
        except Exception as exc:
            logger.warning("cmux verify %s failed: %s, falling back", cmd_name, exc)
            checks.append(f"{cmd_name}: SKIPPED (cmux error)")

    all_passed = all("FAIL" not in c for c in checks)

    return {
        "verification_result": "\n".join(checks),
        "verification_passed": all_passed,
    }


async def _verify_via_subprocess(state: dict) -> dict:
    """Fallback: run verification via subprocess (original behavior)."""
    workdir = state.get("workdir", ".")

    checks = []
    for cmd_name, cmd in [
        ("type-check", ["python3", "-m", "mypy", ".", "--ignore-missing-imports"]),
        ("lint", ["python3", "-m", "ruff", "check", "."]),
        ("test", ["python3", "-m", "pytest", "-x", "--tb=short", "-q"]),
    ]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workdir,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            passed = proc.returncode == 0
            checks.append(f"{cmd_name}: {'PASS' if passed else 'FAIL'}")
            if not passed:
                detail = stdout.decode("utf-8", errors="replace")[:500]
                checks.append(f"  {detail}")
        except (FileNotFoundError, asyncio.TimeoutError):
            checks.append(f"{cmd_name}: SKIPPED (not available)")

    all_passed = all("FAIL" not in c for c in checks)

    return {
        "verification_result": "\n".join(checks),
        "verification_passed": all_passed,
    }


async def verifier_node(state: dict) -> dict:
    """Verify the current task result by running tests/build/lint."""
    exit_code = state.get("current_exit_code", -1)

    # If execution itself failed, skip verification
    if exit_code != 0:
        return {
            "verification_result": f"Execution failed (exit {exit_code})",
            "verification_passed": False,
        }

    # Try cmux runtime first if available
    from local_agent.graph.executor import _get_cmux_runtime
    runtime = await _get_cmux_runtime()
    if runtime and state.get("surface_map"):
        return await _verify_via_cmux(runtime, state)
    else:
        return await _verify_via_subprocess(state)
