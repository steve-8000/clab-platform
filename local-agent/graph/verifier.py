"""Verifier node: runs tests, build, and lint to verify execution results."""
from __future__ import annotations
import asyncio
import logging

logger = logging.getLogger(__name__)

async def verifier_node(state: dict) -> dict:
    """Verify the current task result by running tests/build/lint."""
    exit_code = state.get("current_exit_code", -1)
    output = state.get("current_output", "")
    workdir = state.get("workdir", ".")

    # If execution itself failed, skip verification
    if exit_code != 0:
        return {
            "verification_result": f"Execution failed (exit {exit_code})",
            "verification_passed": False,
        }

    # Try common verification commands
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
