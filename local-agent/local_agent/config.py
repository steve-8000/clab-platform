"""Agent configuration and LLM model factory."""
from __future__ import annotations
import os
from dataclasses import dataclass, field

@dataclass
class AgentConfig:
    control_plane_url: str = "https://ai.clab.one/api/cp"
    knowledge_url: str = "https://ai.clab.one/api/ks"
    llm_provider: str = "anthropic"  # "anthropic" or "openai"
    llm_model: str = ""
    workdir: str = "."
    max_retries: int = 3
    max_iterations: int = 20
    interrupt_before_execute: bool = False

_config: AgentConfig | None = None
_planner_engine_started = False

def configure(config: AgentConfig) -> None:
    global _config
    _config = config

def get_config() -> AgentConfig:
    global _config
    if _config is None:
        _config = AgentConfig(
            control_plane_url=os.getenv("CLAB_CONTROL_URL", "https://ai.clab.one/api/cp"),
            knowledge_url=os.getenv("CLAB_KNOWLEDGE_URL", "https://ai.clab.one/api/ks"),
            llm_provider=os.getenv("LLM_PROVIDER", "anthropic"),
            llm_model=os.getenv("LLM_MODEL", ""),
            workdir=os.getenv("WORKDIR", os.getcwd()),
        )
    return _config

async def invoke_cli(system_prompt: str, user_prompt: str, timeout: float = 120) -> str:
    """Invoke LLM for reasoning. Uses orchestrator's cmux surface if available, subprocess fallback."""
    try:
        from local_agent.graph.executor import _get_cmux_runtime

        runtime = await _get_cmux_runtime()
        if runtime:
            return await _invoke_via_cmux(runtime, system_prompt, user_prompt, timeout)
    except Exception:
        pass
    return await _invoke_via_subprocess(system_prompt, user_prompt, timeout)


async def _invoke_via_cmux(runtime, system_prompt: str, user_prompt: str, timeout: float) -> str:
    """Use the orchestrator's existing cmux workspace for LLM reasoning.

    Reuses the current workspace (reuse_current=True) instead of creating a new one.
    This keeps the planner running in the orchestrator's window.
    """
    import asyncio

    global _planner_engine_started

    workdir = get_config().workdir

    if not runtime.workspace_id:
        await runtime.create_agent("orchestrator", workdir=workdir, reuse_current=True)

    surface_id = await runtime.get_or_create_surface("claude")

    if not _planner_engine_started:
        await runtime.start_engine(surface_id, "claude", workdir)
        _planner_engine_started = True

    full_prompt = f"{system_prompt}\n\n---\n\n{user_prompt}"
    await runtime.inject_command("claude", full_prompt)

    result = await runtime.collect_output("claude", timeout=timeout)
    return result.output


async def _invoke_via_subprocess(system_prompt: str, user_prompt: str, timeout: float) -> str:
    """Fallback: use claude --print or codex subprocess."""
    import asyncio
    import shutil

    full_prompt = f"{system_prompt}\n\n---\n\n{user_prompt}"

    # Try Claude CLI first (preferred)
    if shutil.which("claude"):
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "-p", full_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_config().workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode("utf-8", errors="replace")
        if proc.returncode != 0:
            output += f"\nSTDERR:\n{stderr.decode('utf-8', errors='replace')}"
        return output

    # Fallback to Codex CLI
    if shutil.which("codex"):
        proc = await asyncio.create_subprocess_exec(
            "codex", "--quiet", "-p", full_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_config().workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode("utf-8", errors="replace")

    raise RuntimeError("Neither 'claude' nor 'codex' CLI found in PATH")
