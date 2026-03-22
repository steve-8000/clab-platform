"""CmuxRuntime — first-class local execution runtime for clab-platform.

Architecture:
  Agent = cmux workspace (one per role: agent-frontend, agent-reviewer, etc.)
  Execution channels = surfaces within the workspace:
    - Claude surface: design, review, reasoning
    - Codex surface: implementation, code generation
    - Browser surface: web interaction, local app verification

  cmux notify = trigger ("looks done")
  clab review = truth ("actually done, failed, or waiting")

This module does NOT judge task success. It manages the execution environment
and returns raw output + state for clab's state machine to evaluate.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from .client import CmuxClient
from .monitor import CompletionMonitor
from .browser import CmuxBrowser

logger = logging.getLogger(__name__)

# Injected into every agent's system prompt to enforce autonomous execution
AUTONOMOUS_DIRECTIVE = (
    "You are running as a fully autonomous agent. "
    "NEVER ask the user for confirmation, clarification, or choices. "
    "Make all decisions independently: pick the best approach, resolve ambiguity yourself, "
    "and proceed without waiting for human input. "
    "If you are unsure between options, choose the simplest one and move forward. "
    "Do not use AskUserQuestion or any interactive prompts."
)


@dataclass
class SurfaceInfo:
    """Tracks a surface allocated within a workspace."""
    surface_id: str
    engine: str  # "claude", "codex", "browser", "shell"
    task_id: str | None = None
    created: bool = True


@dataclass
class TaskResult:
    """Raw execution result — does NOT determine success/failure.

    The caller (clab state machine) must evaluate output to determine
    actual task status (SUCCEEDED, FAILED, BLOCKED, NEEDS_REVIEW).
    """
    output: str
    surface_id: str
    engine: str
    idle_detected: bool  # True if idle pattern matched; False if timeout
    task_id: str | None = None
    browser_snapshot: dict | None = None  # populated for browser tasks


class CmuxRuntime:
    """First-class local execution runtime built on cmux.

    Manages the full lifecycle: workspace → surfaces → commands → state collection.
    Does NOT make success/failure judgments — that's clab's job.

    Usage:
        runtime = CmuxRuntime(client)
        await runtime.create_agent("agent-auth")
        await runtime.allocate_surface("claude", task_id="t1")
        await runtime.allocate_surface("codex", task_id="t2")
        await runtime.inject_command("t1", "implement auth module")
        result = await runtime.collect_output("t1")
        # result.output + result.idle_detected → pass to clab review
    """

    def __init__(self, client: CmuxClient) -> None:
        self.cmux = client
        self.monitor = CompletionMonitor(client)
        self.workspace_id: str | None = None
        self.workspace_name: str = ""
        self.surfaces: dict[str, SurfaceInfo] = {}  # task_id or engine → SurfaceInfo
        self._browser: CmuxBrowser | None = None

    # ---- Workspace (= Agent) lifecycle ----

    async def create_agent(self, name: str) -> str:
        """Create a cmux workspace representing one agent.

        Args:
            name: Agent name (e.g., "agent-auth", "agent-reviewer")

        Returns:
            workspace_id
        """
        ws = await self.cmux.workspace_create(name[:40])
        self.workspace_id = ws.get("id", ws.get("workspace_id"))
        self.workspace_name = name
        logger.info("Agent created: workspace=%s name=%s", self.workspace_id, name)
        return self.workspace_id

    # ---- Surface (= Execution Channel) allocation ----

    async def allocate_surface(self, engine: str, task_id: str | None = None) -> str:
        """Allocate a surface within the agent's workspace.

        Args:
            engine: "claude", "codex", "browser", or "shell"
            task_id: Optional task identifier to map this surface to

        Returns:
            surface_id
        """
        if not self.workspace_id:
            raise RuntimeError("No agent created — call create_agent() first")

        key = task_id or engine

        if engine == "browser":
            return await self._allocate_browser()

        surface = await self.cmux.surface_create(self.workspace_id)
        surface_id = surface.get("surface_id", surface.get("id"))
        self.surfaces[key] = SurfaceInfo(
            surface_id=surface_id,
            engine=engine,
            task_id=task_id,
        )
        logger.info("Surface allocated: key=%s surface=%s engine=%s", key, surface_id, engine)
        return surface_id

    async def _allocate_browser(self) -> str:
        """Allocate browser surface — reused across browser tasks."""
        if self._browser and self._browser.surface_id:
            return self._browser.surface_id
        self._browser = CmuxBrowser(self.cmux, self.workspace_id)
        surface_id = await self._browser.open()
        self.surfaces["browser"] = SurfaceInfo(
            surface_id=surface_id, engine="browser"
        )
        return surface_id

    def get_surface_id(self, key: str) -> str | None:
        """Look up surface_id by task_id or engine name."""
        info = self.surfaces.get(key)
        return info.surface_id if info else None

    # ---- Command injection ----

    async def start_engine(
        self,
        surface_id: str,
        engine: str,
        workdir: str,
        system_prompt: str = "",
    ) -> None:
        """Start an engine (Claude/Codex) in a surface.

        This does cd + engine launch but does NOT submit a task instruction yet.
        """
        await self.cmux.send_text(surface_id, f"cd {workdir}\n")
        await asyncio.sleep(0.5)

        if engine == "claude":
            full_prompt = f"{AUTONOMOUS_DIRECTIVE}\n\n{system_prompt}" if system_prompt else AUTONOMOUS_DIRECTIVE
            escaped = full_prompt.replace("'", "'\\''")
            cmd_parts = [
                "claude",
                "--dangerously-skip-permissions",
                "--allowedTools", "'*'",
            ]
            if escaped:
                cmd_parts.extend(["--append-system-prompt", f"'{escaped}'"])
            await self.cmux.send_text(surface_id, " ".join(cmd_parts) + "\n")
            await asyncio.sleep(2)

            # Handle bypass permissions prompt (auto-accept)
            if await self.monitor.detect_bypass_prompt(surface_id, timeout=5):
                await self.cmux.send_text(surface_id, "2")
                await self.cmux.send_key(surface_id, "Enter")
                await asyncio.sleep(1)

        elif engine == "codex":
            await self.cmux.send_text(surface_id, "codex --full-auto\n")
            await asyncio.sleep(2)

    async def inject_command(self, key: str, instruction: str) -> None:
        """Send a command/instruction to a surface.

        Args:
            key: task_id or engine name to look up the surface
            instruction: text to send
        """
        info = self.surfaces.get(key)
        if not info:
            raise KeyError(f"No surface found for key: {key}")
        await self.cmux.send_text(info.surface_id, instruction + "\n")

    async def inject_key(self, key: str, keyseq: str) -> None:
        """Send a key sequence (e.g., 'C-c') to a surface."""
        info = self.surfaces.get(key)
        if not info:
            raise KeyError(f"No surface found for key: {key}")
        await self.cmux.send_key(info.surface_id, keyseq)

    # ---- State collection (raw — no success/failure judgment) ----

    async def collect_output(
        self,
        key: str,
        timeout: float = 300,
    ) -> TaskResult:
        """Wait for engine idle and collect raw output.

        Returns TaskResult with raw output. Does NOT determine success/failure.
        The caller (clab state machine) must evaluate the output.
        """
        info = self.surfaces.get(key)
        if not info:
            raise KeyError(f"No surface found for key: {key}")

        idle_detected = True
        try:
            output = await self.monitor.wait_for_idle(
                info.surface_id, info.engine, timeout=timeout
            )
        except TimeoutError:
            output = await self.cmux.read_text(info.surface_id)
            idle_detected = False
            logger.warning("Timeout collecting output for %s", key)

        return TaskResult(
            output=output,
            surface_id=info.surface_id,
            engine=info.engine,
            idle_detected=idle_detected,
            task_id=info.task_id,
        )

    async def read_current_output(self, key: str) -> str:
        """Read current terminal content without waiting for idle."""
        info = self.surfaces.get(key)
        if not info:
            return ""
        return await self.cmux.read_text(info.surface_id)

    async def run_shell_command(self, surface_id: str, command: str) -> str:
        """Run a shell command and wait for prompt return.

        Used for verification commands (pytest, ruff, etc.) in an existing surface.
        """
        await self.cmux.send_text(surface_id, command + "\n")
        return await self.monitor.wait_for_shell_prompt(surface_id, timeout=60)

    # ---- Browser interaction (agent interaction layer) ----

    @property
    def browser(self) -> CmuxBrowser | None:
        return self._browser

    async def browser_interact(self, url: str) -> dict:
        """Open browser and return snapshot for LLM consumption."""
        if not self._browser:
            await self._allocate_browser()
        await self._browser.navigate(url)
        await asyncio.sleep(1)  # wait for page load
        snapshot = await self._browser.snapshot()
        return {
            "surface_id": self._browser.surface_id,
            "url": url,
            "snapshot": snapshot,
        }

    # ---- Notifications (trigger, not truth) ----

    async def signal_completion(self, key: str, message: str = "") -> None:
        """Send a cmux notification that a task appears complete.

        This is a TRIGGER only — clab must still verify actual completion.
        """
        info = self.surfaces.get(key)
        title = f"[{self.workspace_name}] {key}"
        await self.cmux.notify(
            title=title[:50],
            body=message[:200] or "Task appears complete",
            surface_id=info.surface_id if info else None,
        )

    # ---- Cleanup ----

    async def release_surface(self, key: str) -> None:
        """Close a specific surface."""
        info = self.surfaces.pop(key, None)
        if info:
            try:
                await self.cmux.surface_close(info.surface_id)
            except Exception as exc:
                logger.debug("Failed to close surface %s: %s", info.surface_id, exc)

    async def shutdown(self) -> None:
        """Release all surfaces and browser. Workspace remains for inspection."""
        if self._browser:
            await self._browser.close()
            self._browser = None
            self.surfaces.pop("browser", None)

        for key in list(self.surfaces):
            await self.release_surface(key)

        logger.info("Runtime shutdown: workspace=%s", self.workspace_id)
