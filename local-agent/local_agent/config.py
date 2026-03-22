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
    """Invoke LLM for reasoning. Prefers cmux surface, falls back to CLI subprocess.

    In cmux environments, claude runs as a TUI and --print may hang.
    This function routes through the cmux runtime's claude surface when available,
    falling back to subprocess for non-cmux environments.
    """
    # Try cmux runtime first (preferred in cmux environment)
    try:
        from local_agent.graph.executor import _get_cmux_runtime
        runtime = await _get_cmux_runtime()
        if runtime:
            return await _invoke_via_cmux(runtime, system_prompt, user_prompt, timeout)
    except Exception:
        pass  # fall through to subprocess

    # Fallback: subprocess
    return await _invoke_via_subprocess(system_prompt, user_prompt, timeout)


# Engine name for LLM reasoning — shares the same claude surface as executor
_REASONING_ENGINE = "claude"
_claude_engine_started = False


async def _invoke_via_cmux(runtime, system_prompt: str, user_prompt: str, timeout: float) -> str:
    """Use cmux runtime's claude surface for LLM reasoning.

    Shares the 'claude' surface with the executor so planner, replanner,
    and reviewer all share conversation context in the same TUI.
    """
    import asyncio
    global _claude_engine_started

    workdir = get_config().workdir
    engine = _REASONING_ENGINE

    # Ensure workspace exists (create_agent is idempotent — reuses current workspace)
    if not runtime.workspace_id:
        await runtime.create_agent("llm-reason", workdir=workdir)

    # Get or create a surface for this reasoning engine
    surface_id = await runtime.get_or_create_surface(engine)

    # Start engine only on first use
    if not _claude_engine_started:
        await runtime.start_engine(surface_id, "claude", workdir)
        _claude_engine_started = True

    # Build prompt and inject
    full_prompt = f"{system_prompt}\n\n---\n\n{user_prompt}"
    await runtime.inject_command(engine, full_prompt)

    # Collect output
    result = await runtime.collect_output(engine, timeout=timeout)
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
