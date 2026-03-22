"""Agent configuration and LLM model factory."""
from __future__ import annotations
import os
from dataclasses import dataclass

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
_planner_runtime = None
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

async def _get_planner_runtime():
    """Get or create a dedicated CmuxRuntime for planner/reasoning. Separate from executor."""
    global _planner_runtime
    if _planner_runtime is not None:
        return _planner_runtime

    import shutil
    if not shutil.which("cmux"):
        return None

    try:
        from local_agent.cmux import CmuxClient, CmuxRuntime
        client = CmuxClient()
        await client.connect()
        _planner_runtime = CmuxRuntime(client)
        return _planner_runtime
    except Exception:
        return None


async def invoke_cli(system_prompt: str, user_prompt: str, timeout: float = 120) -> str:
    """Invoke LLM for reasoning. Uses dedicated planner cmux surface, subprocess fallback."""
    try:
        runtime = await _get_planner_runtime()
        if runtime:
            return await _invoke_via_cmux(runtime, system_prompt, user_prompt, timeout)
    except Exception:
        pass
    return await _invoke_via_subprocess(system_prompt, user_prompt, timeout)


async def _invoke_via_cmux(runtime, system_prompt: str, user_prompt: str, timeout: float) -> str:
    """Use agent workspace for reasoning via codex. Creates agent WS if needed."""
    global _planner_engine_started

    workdir = get_config().workdir

    if not runtime.workspace_id:
        await runtime.create_agent("agent-planner", workdir=workdir, reuse_current=False)

    surface_id = await runtime.get_or_create_surface("codex")

    if not _planner_engine_started:
        await runtime.start_engine(surface_id, "codex", workdir)
        _planner_engine_started = True

    full_prompt = f"{system_prompt}\n\n---\n\n{user_prompt}"
    await runtime.inject_command("codex", full_prompt)

    result = await runtime.collect_output("codex", timeout=timeout)
    return result.output


async def cleanup_planner_runtime():
    """Shutdown planner runtime. Called after mission."""
    global _planner_runtime, _planner_engine_started
    if _planner_runtime:
        try:
            # Don't shutdown surfaces — orchestrator workspace stays alive
            await _planner_runtime.cmux.disconnect()
        except Exception:
            pass
        _planner_runtime = None
    _planner_engine_started = False


async def _invoke_via_subprocess(system_prompt: str, user_prompt: str, timeout: float) -> str:
    """Fallback: use codex subprocess (preferred) or claude."""
    import asyncio
    import shutil

    full_prompt = f"{system_prompt}\n\n---\n\n{user_prompt}"

    # Try Codex CLI first (preferred)
    if shutil.which("codex"):
        proc = await asyncio.create_subprocess_exec(
            "codex", "--quiet", "-p", full_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_config().workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode("utf-8", errors="replace")
        if proc.returncode != 0:
            output += f"\nSTDERR:\n{stderr.decode('utf-8', errors='replace')}"
        return output

    # Fallback to Claude CLI
    if shutil.which("claude"):
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "-p", full_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_config().workdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode("utf-8", errors="replace")

    raise RuntimeError("Neither 'codex' nor 'claude' CLI found in PATH")
