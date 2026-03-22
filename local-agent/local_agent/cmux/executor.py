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
        surface = await runtime.get_or_create_surface("claude")
        await runtime.start_engine(surface, "claude", workdir)
        await runtime.inject_command("claude", "implement auth module")
        result = await runtime.collect_output("claude")
        # result.output + result.idle_detected → pass to clab review
    """

    def __init__(self, client: CmuxClient) -> None:
        self.cmux = client
        self.monitor = CompletionMonitor(client)
        self.workspace_id: str | None = None
        self.workspace_name: str = ""
        # Engine-level surfaces — ONE surface per engine, reused across tasks
        self._engine_surfaces: dict[str, str] = {}  # engine → surface_id
        self._browser: CmuxBrowser | None = None
        self._right_surface_id: str | None = None

    # ---- Workspace (= Agent) lifecycle ----

    async def create_agent(self, name: str, workdir: str = "") -> str:
        """Get or create a cmux workspace for this agent.

        Reuses an existing workspace matching the workdir if one exists.
        Only creates a new workspace if none is found.
        One workspace = one agent. Multiple surfaces within it = parallel channels.
        """
        # Try to reuse the currently selected/active workspace first
        try:
            current = await self.cmux.workspace_current()
            if current:
                self.workspace_id = current.get("id", current.get("workspace_id"))
                self.workspace_name = name
                # Rename workspace to reflect the project/agent name
                try:
                    await self.cmux.workspace_rename(name[:40], self.workspace_id)
                except Exception:
                    pass
                logger.info("Reusing current workspace: %s (renamed to %s)", self.workspace_id, name)
                return self.workspace_id
        except Exception as exc:
            logger.debug("Failed to get current workspace: %s", exc)

        # Also try to reuse current workspace if workspace_id is already set
        if self.workspace_id:
            logger.info("Reusing existing workspace: %s", self.workspace_id)
            return self.workspace_id

        # Create new workspace only if nothing to reuse
        ws = await self.cmux.workspace_create(name[:40])
        self.workspace_id = ws.get("id", ws.get("workspace_id"))
        self.workspace_name = name
        logger.info("New workspace created: %s (%s)", self.workspace_id, name)
        return self.workspace_id

    # ---- Surface (= Execution Channel) allocation ----

    async def get_or_create_surface(self, engine: str) -> str:
        """Get existing surface for this engine, or create one.

        Surface model: ONE surface per engine type, reused across all tasks.
          - codex surface: all codex tasks run here sequentially
          - claude surface: all claude tasks run here sequentially
          - browser surface: all browser tasks run here

        Max surfaces: Main(left) + codex + claude + browser = 4 total
        """
        if not self.workspace_id:
            raise RuntimeError("No agent created — call create_agent() first")

        if engine == "browser":
            return await self._allocate_browser()

        # Return existing surface if already created for this engine
        if engine in self._engine_surfaces:
            surface_id = self._engine_surfaces[engine]
            logger.debug("Reusing %s surface: %s", engine, surface_id)
            return surface_id

        # Create new surface — first one splits RIGHT, second splits DOWN
        if self._right_surface_id:
            surface = await self.cmux.surface_split("down", self.workspace_id, self._right_surface_id)
        else:
            surface = await self.cmux.surface_split("right", self.workspace_id)

        surface_id = surface.get("surface_id", surface.get("id"))
        if not self._right_surface_id:
            self._right_surface_id = surface_id

        self._engine_surfaces[engine] = surface_id

        # Rename surface tab to show engine name
        try:
            await self.cmux.request("surface.rename", {
                "surface_id": surface_id,
                "name": f"worker:{engine}",
            })
        except Exception:
            pass  # rename might not be supported as RPC

        logger.info("Created %s surface: %s", engine, surface_id)
        return surface_id

    async def _allocate_browser(self) -> str:
        """Allocate browser surface — reused across browser tasks."""
        if self._browser and self._browser.surface_id:
            return self._browser.surface_id
        self._browser = CmuxBrowser(self.cmux, self.workspace_id)
        surface_id = await self._browser.open()
        self._engine_surfaces["browser"] = surface_id
        return surface_id

    def get_surface_id(self, engine: str) -> str | None:
        """Look up surface_id by engine name."""
        return self._engine_surfaces.get(engine)

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
            await self.cmux.send_text(surface_id, " ".join(cmd_parts))
            await asyncio.sleep(1.0)
            await self.cmux.send_key(surface_id, "enter")
            await asyncio.sleep(3)

            # Handle bypass permissions prompt (auto-accept)
            if await self.monitor.detect_bypass_prompt(surface_id, timeout=5):
                await self.cmux.send_text(surface_id, "2")
                await self.cmux.send_key(surface_id, "Enter")
                await asyncio.sleep(1)

        elif engine == "codex":
            await self.cmux.send_text(surface_id, "codex")
            await asyncio.sleep(1.0)
            await self.cmux.send_key(surface_id, "enter")
            await asyncio.sleep(3)

    async def inject_command(self, engine: str, instruction: str) -> None:
        """Send a command/instruction to an engine's surface, then press Enter.

        For TUI apps (Codex/Claude), send_text + send_key enter must be separate.
        """
        surface_id = self._engine_surfaces.get(engine)
        if not surface_id:
            raise KeyError(f"No surface found for engine: {engine}")
        await self.cmux.send_text(surface_id, instruction)
        await asyncio.sleep(1.0)
        await self.cmux.send_key(surface_id, "enter")

    async def inject_key(self, engine: str, keyseq: str) -> None:
        """Send a key sequence (e.g., 'C-c') to an engine's surface."""
        surface_id = self._engine_surfaces.get(engine)
        if not surface_id:
            raise KeyError(f"No surface found for engine: {engine}")
        await self.cmux.send_key(surface_id, keyseq)

    # ---- State collection (raw — no success/failure judgment) ----

    async def collect_output(
        self,
        engine: str,
        timeout: float = 300,
        task_id: str | None = None,
    ) -> TaskResult:
        """Wait for engine idle and collect raw output.

        Returns TaskResult with raw output. Does NOT determine success/failure.
        """
        surface_id = self._engine_surfaces.get(engine)
        if not surface_id:
            raise KeyError(f"No surface found for engine: {engine}")

        idle_detected = True
        try:
            output = await self.monitor.wait_for_idle(
                surface_id, engine, timeout=timeout
            )
        except TimeoutError:
            output = await self.cmux.read_text(surface_id)
            idle_detected = False
            logger.warning("Timeout collecting output for %s", engine)

        return TaskResult(
            output=output,
            surface_id=surface_id,
            engine=engine,
            idle_detected=idle_detected,
            task_id=task_id,
        )

    async def read_current_output(self, engine: str) -> str:
        """Read current terminal content without waiting for idle."""
        surface_id = self._engine_surfaces.get(engine)
        if not surface_id:
            return ""
        return await self.cmux.read_text(surface_id)

    async def run_shell_command(self, surface_id: str, command: str) -> str:
        """Run a shell command and wait for prompt return.

        Used for verification commands (pytest, ruff, etc.) in an existing surface.
        For TUI apps, send_text + send_key enter must be separate.
        """
        await self.cmux.send_text(surface_id, command)
        await asyncio.sleep(1.0)
        await self.cmux.send_key(surface_id, "enter")
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

    async def signal_completion(self, engine: str, task_title: str = "", message: str = "") -> None:
        """Send a cmux notification that a task appears complete.

        This is a TRIGGER only — clab must still verify actual completion.
        """
        surface_id = self._engine_surfaces.get(engine)
        title = f"[{self.workspace_name}] {task_title or engine}"
        await self.cmux.notify(
            title=title[:50],
            body=message[:200] or "Task appears complete",
            surface_id=surface_id,
        )

    # ---- Cleanup ----

    async def release_surface(self, engine: str) -> None:
        """Close a specific engine's surface."""
        surface_id = self._engine_surfaces.pop(engine, None)
        if surface_id:
            try:
                await self.cmux.surface_close(surface_id)
            except Exception as exc:
                logger.debug("Failed to close surface %s: %s", surface_id, exc)
        if surface_id == self._right_surface_id:
            self._right_surface_id = None

    async def shutdown(self) -> None:
        """Release all surfaces and browser. Workspace remains for inspection."""
        if self._browser:
            await self._browser.close()
            self._browser = None

        for engine in list(self._engine_surfaces):
            await self.release_surface(engine)

        logger.info("Runtime shutdown: workspace=%s", self.workspace_id)
