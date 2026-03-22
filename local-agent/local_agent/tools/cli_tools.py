"""CLI execution tools — run Claude/Codex CLI as subprocess."""
from __future__ import annotations
import asyncio
from langchain_core.tools import tool

@tool
async def exec_claude(prompt: str, workdir: str = ".") -> str:
    """Execute a task using Claude CLI. Use for complex reasoning, code review, architecture.
    Args:
        prompt: The task prompt
        workdir: Working directory
    """
    return await _run_cli("claude", ["claude", "--print", "-p", prompt], workdir)

@tool
async def exec_codex(prompt: str, workdir: str = ".") -> str:
    """Execute a task using Codex CLI. Use for code generation, implementation, quick fixes.
    Args:
        prompt: The task prompt
        workdir: Working directory
    """
    return await _run_cli("codex", ["codex", "--quiet", "-p", prompt], workdir)

@tool
async def run_test(command: str = "python3 -m pytest -x --tb=short -q", workdir: str = ".") -> str:
    """Run tests to verify code changes.
    Args:
        command: Test command (default: pytest)
        workdir: Working directory
    """
    parts = command.split()
    return await _run_cli("test", parts, workdir, timeout=120)

@tool
async def run_build(command: str = "python3 -m py_compile", workdir: str = ".") -> str:
    """Run build/compile to verify code compiles.
    Args:
        command: Build command
        workdir: Working directory
    """
    parts = command.split()
    return await _run_cli("build", parts, workdir, timeout=60)

async def _run_cli(name: str, cmd: list[str], workdir: str, timeout: int = 300) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        out = stdout.decode("utf-8", errors="replace")
        err = stderr.decode("utf-8", errors="replace")
        if proc.returncode != 0:
            return f"[{name} FAILED exit={proc.returncode}]\n{out}\nSTDERR:\n{err}"
        return out
    except asyncio.TimeoutError:
        return f"[{name} TIMEOUT after {timeout}s]"
    except FileNotFoundError:
        return f"[{name} NOT FOUND: {cmd[0]}]"
