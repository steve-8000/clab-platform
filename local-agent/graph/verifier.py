"""Verifier node: runs tests, lint, and type-check via subprocess.

Verification always runs as subprocess (not in cmux surfaces) because:
- cmux surfaces may have Codex/Claude TUI running, not a shell
- Verification tools (mypy, ruff, pytest) must run in the project's venv
"""
from __future__ import annotations
import asyncio
import os
import logging

from graph.state import AgentState

logger = logging.getLogger(__name__)

# Prefer venv python for verification tools
VENV_PYTHON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".venv", "bin", "python"
)


def _get_python() -> str:
    """Get the best python executable for running verification tools."""
    if os.path.isfile(VENV_PYTHON):
        return VENV_PYTHON
    return "python3"


async def verifier_node(state: AgentState) -> dict:
    """Verify the current task result by running lint, type-check, and tests.

    Always uses subprocess — never runs inside cmux surfaces.
    """
    exit_code = state.get("current_exit_code", -1)

    if exit_code != 0:
        return {
            "verification_result": f"Execution failed (exit {exit_code})",
            "verification_passed": False,
        }

    workdir = state.get("workdir", ".")
    python = _get_python()

    checks = []
    pass_count = 0
    fail_count = 0
    skip_count = 0

    for cmd_name, cmd in [
        ("lint", [python, "-m", "ruff", "check", "."]),
        ("type-check", [python, "-m", "mypy", ".", "--ignore-missing-imports"]),
        ("test", [python, "-m", "pytest", "-x", "--tb=short", "-q"]),
    ]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workdir,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            output = stdout.decode("utf-8", errors="replace")
            err_output = stderr.decode("utf-8", errors="replace")

            if proc.returncode == 0:
                checks.append(f"{cmd_name}: PASS")
                pass_count += 1
            elif "No module named" in err_output:
                checks.append(f"{cmd_name}: SKIP (not installed)")
                skip_count += 1
            elif proc.returncode == 5 and "no tests ran" in output:
                # pytest exit code 5 = no tests collected (not a failure)
                checks.append(f"{cmd_name}: SKIP (no tests found)")
                skip_count += 1
            else:
                checks.append(f"{cmd_name}: FAIL (exit {proc.returncode})")
                detail = (output + err_output)[:500].strip()
                if detail:
                    checks.append(f"  {detail}")
                fail_count += 1

        except FileNotFoundError:
            checks.append(f"{cmd_name}: SKIP ({cmd[0]} not found)")
            skip_count += 1
        except asyncio.TimeoutError:
            checks.append(f"{cmd_name}: FAIL (timeout)")
            fail_count += 1

    # Passed = no failures (skips are acceptable for non-Python projects)
    all_passed = fail_count == 0

    summary = f"Results: {pass_count} pass, {fail_count} fail, {skip_count} skip"
    checks.append(summary)
    logger.info("Verification %s: %s", "PASSED" if all_passed else "FAILED", summary)

    return {
        "verification_result": "\n".join(checks),
        "verification_passed": all_passed,
    }
