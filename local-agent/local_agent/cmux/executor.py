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
# Workspace lifecycle: persists across missions

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass

from .client import CmuxClient
from .monitor import CompletionMonitor
from .browser import CmuxBrowser
from .worker import WorkerPool

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
class SurfaceEntry:
    """A registered surface with its role and metadata."""
    surface_id: str
    role: str        # "claude", "codex", "codex-worker-0", "codex-worker-1", "codex-worker-2", "browser"
    engine: str      # "claude", "codex", "browser"
    started: bool = False
    task_id: str | None = None  # currently assigned task
    owned: bool = True  # False if shared/borrowed (don't close on shutdown)


class SurfaceRegistry:
    """Central registry mapping roles to surface IDs.

    Ensures commands go to the correct surface by role lookup.
    Provides validation and debugging support.
    """

    def __init__(self) -> None:
        self._surfaces: dict[str, SurfaceEntry] = {}  # role -> SurfaceEntry

    def register(self, role: str, surface_id: str, engine: str, owned: bool = True) -> None:
        """Register a surface with a role."""
        self._surfaces[role] = SurfaceEntry(
            surface_id=surface_id, role=role, engine=engine, owned=owned,
        )
        logger.info("Surface registered: role=%s surface=%s engine=%s owned=%s", role, surface_id, engine, owned)

    def get(self, role: str) -> str:
        """Get surface_id by role. Raises KeyError if not found."""
        entry = self._surfaces.get(role)
        if not entry:
            available = list(self._surfaces.keys())
            raise KeyError(f"No surface for role '{role}'. Available: {available}")
        return entry.surface_id

    def get_entry(self, role: str) -> SurfaceEntry | None:
        """Get full entry by role."""
        return self._surfaces.get(role)

    def get_by_engine(self, engine: str) -> str | None:
        """Get first surface_id matching engine type."""
        for entry in self._surfaces.values():
            if entry.engine == engine:
                return entry.surface_id
        return None

    def has(self, role: str) -> bool:
        return role in self._surfaces

    def mark_started(self, role: str) -> None:
        if role in self._surfaces:
            self._surfaces[role].started = True

    def is_started(self, role: str) -> bool:
        entry = self._surfaces.get(role)
        return entry.started if entry else False

    def assign_task(self, role: str, task_id: str | None) -> None:
        if role in self._surfaces:
            self._surfaces[role].task_id = task_id

    def remove(self, role: str) -> str | None:
        entry = self._surfaces.pop(role, None)
        return entry.surface_id if entry else None

    def owned_surfaces(self) -> list[SurfaceEntry]:
        """Surfaces we own and should close on shutdown."""
        return [e for e in self._surfaces.values() if e.owned]

    def all_roles(self) -> list[str]:
        return list(self._surfaces.keys())

    def dump(self) -> str:
        """Debug string showing all registered surfaces."""
        lines = []
        for role, entry in self._surfaces.items():
            status = "started" if entry.started else "pending"
            task = f" task={entry.task_id}" if entry.task_id else ""
            own = "" if entry.owned else " (shared)"
            lines.append(f"  {role}: {entry.surface_id[:8]}... [{entry.engine}] {status}{task}{own}")
        return "\n".join(lines) or "  (empty)"


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
        self._orchestrator_ws_id: str | None = None
        self.workspace_name: str = ""
        # Engine-level surfaces — ONE surface per engine, reused across tasks
        self.surfaces = SurfaceRegistry()
        self._engine_surfaces: dict[str, str] = {}  # engine → surface_id
        self._engine_lock = asyncio.Lock()  # protects _engine_surfaces + surface creation
        self._browser: CmuxBrowser | None = None
        self._split_targets: list[str] = []
        self._worker_pool: WorkerPool | None = None
        self._utility_workspace_id: str | None = None
        self._utility_terminal_id: str | None = None
        self._current_workdir: str = ""

    # ---- Workspace (= Agent) lifecycle ----

    async def create_agent(self, name: str, workdir: str = "", reuse_current: bool = False) -> str:
        """Create a new cmux workspace for this agent.

        By default creates a NEW workspace. Set reuse_current=True to reuse
        the active workspace (useful when the caller IS the workspace owner).
        """
        # Idempotent: if we already have a workspace, reuse it
        if self.workspace_id:
            logger.info("Reusing existing workspace: %s", self.workspace_id)
            return self.workspace_id

        # Optionally reuse current workspace
        if reuse_current:
            try:
                current = await self.cmux.workspace_current()
                if current:
                    self.workspace_id = current.get("id", current.get("workspace_id"))
                    self._orchestrator_ws_id = self.workspace_id
                    self.workspace_name = name
                    self._current_workdir = workdir
                    self._split_targets = []
                    try:
                        await self.cmux.workspace_rename(name[:40], self.workspace_id)
                        await self.cmux.request("workspace.action", {"workspace_id": self.workspace_id, "action": "pin"})
                    except Exception:
                        pass
                    logger.info("Reusing current workspace as orchestrator: %s (renamed to %s)", self.workspace_id, name)
                    return self.workspace_id
            except Exception as exc:
                logger.debug("Failed to get current workspace: %s", exc)

        # Create new workspace
        ws = await self.cmux.workspace_create(name[:40])
        self.workspace_id = ws.get("id", ws.get("workspace_id"))
        self.workspace_name = name
        self._current_workdir = workdir
        self._split_targets = []
        try:
            await self.cmux.workspace_rename(name[:40], self.workspace_id)
            await self.cmux.request("workspace.action", {"workspace_id": self.workspace_id, "action": "pin"})
        except Exception:
            pass
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

        async with self._engine_lock:
            # Return existing surface if already created for this engine
            if engine in self._engine_surfaces:
                surface_id = self._engine_surfaces[engine]
                logger.debug("Reusing %s surface: %s", engine, surface_id)
                return surface_id

            if not self._split_targets:
                surfaces = await self.cmux.surface_list(self.workspace_id)
                main_surface_id = surfaces[0].get("surface_id", surfaces[0].get("id")) if surfaces else None
                if not main_surface_id:
                    raise RuntimeError("No main surface found for workspace")
                self._split_targets = [main_surface_id]

            split_count = len(self._engine_surfaces)
            if split_count == 0:
                target_id = self._split_targets[0]
                surface = await self.cmux.surface_split("right", self.workspace_id, target_id)
            elif split_count == 1:
                target_id = self._split_targets[0]
                surface = await self.cmux.surface_split("down", self.workspace_id, target_id)
            else:
                if len(self._split_targets) < 2:
                    raise RuntimeError("Right split target missing for workspace")
                target_id = self._split_targets[1]
                surface = await self.cmux.surface_split("down", self.workspace_id, target_id)

            surface_id = surface.get("surface_id", surface.get("id"))
            if split_count == 0:
                self._split_targets.append(surface_id)

            self._engine_surfaces[engine] = surface_id
            self.surfaces.register(engine, surface_id, engine)

        # Rename surface tab to show engine name (outside lock — non-critical)
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
        ws_id = self._orchestrator_ws_id or self.workspace_id
        self._browser = CmuxBrowser(self.cmux, ws_id)
        surface_id = await self._browser.open()
        self._engine_surfaces["browser"] = surface_id
        self.surfaces.register("browser", surface_id, "browser")
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
            # Wait for codex TUI ready instead of blind sleep
            await self._wait_for_codex_ready(surface_id, timeout=15)

        self.surfaces.mark_started(engine)

    async def _wait_for_codex_ready(self, surface_id: str, timeout: float = 15) -> None:
        """Wait until codex TUI shows idle prompt."""
        import time as _time

        start = _time.monotonic()
        while _time.monotonic() - start < timeout:
            output = await self.cmux.read_text(surface_id)
            tail = output[-500:] if output else ""
            if "›" in tail and "gpt-" in tail.lower():
                logger.debug("Codex TUI ready on surface %s", surface_id)
                return
            await asyncio.sleep(1.0)
        logger.warning("Codex ready timeout on surface %s after %.0fs", surface_id, timeout)

    async def write_prompt_file(self, instruction: str, workdir: str = "") -> str:
        """Write long prompt to project-local file, return reference instruction."""
        prompt_id = uuid.uuid4().hex[:8]
        base_dir = workdir or os.getcwd()
        prompt_dir = os.path.join(base_dir, ".clab", "prompts")
        os.makedirs(prompt_dir, exist_ok=True)
        prompt_path = os.path.join(prompt_dir, f"{prompt_id}.md")

        with open(prompt_path, "w") as f:
            f.write(instruction)

        logger.info("Prompt file written: %s (%d chars)", prompt_path, len(instruction))
        return (
            f"Do not produce a task list or plan. "
            f"Execute the instructions in {prompt_path} now. "
            f"Make code changes directly. Fix any errors. "
            f"Do not stop after analysis or planning."
        )

    async def inject_command(self, engine: str, instruction: str) -> None:
        """Send a command/instruction to an engine's surface, then press Enter.

        For TUI apps (Codex/Claude), send_text + send_key enter must be separate.
        For long prompts (>2000 chars), writes to a temp file to avoid TUI truncation.
        """
        surface_id = self._engine_surfaces.get(engine)
        if not surface_id:
            raise KeyError(f"No surface found for engine: {engine}")
        self.monitor.reset_prompt_tracking(surface_id)

        # For long prompts, write to temp file to avoid TUI input buffer truncation
        if len(instruction) > 2000:
            instruction = await self.write_prompt_file(instruction, workdir=self._current_workdir or "")

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

    # ---- Multi-worker parallel execution ----

    async def create_worker_pool(
        self,
        num_workers: int = 3,
        workdir: str = "",
        system_prompt: str = "",
    ) -> WorkerPool:
        """Create a pool of N codex workers + 1 codex reviewer. Idempotent."""
        if self._worker_pool is not None:
            logger.info("Reusing existing worker pool")
            return self._worker_pool

        if not self.workspace_id:
            raise RuntimeError("No agent created — call create_agent() first")

        from local_agent.config import _planner_engine_started, _planner_runtime
        planner_codex_surface = None
        if _planner_engine_started and _planner_runtime:
            planner_codex_surface = _planner_runtime.get_surface_id("codex")
        pool = WorkerPool(
            self.cmux,
            self.workspace_id,
            num_workers,
            registry=self.surfaces,
            reviewer_engine_started=_planner_engine_started,
            reviewer_surface_id=planner_codex_surface,
        )
        await pool.initialize(workdir, system_prompt)
        self._worker_pool = pool
        return pool

    @property
    def worker_pool(self) -> WorkerPool | None:
        return self._worker_pool

    async def execute_parallel(
        self,
        tasks: list[dict],
        timeout: float = 300,
    ) -> list[TaskResult]:
        """Execute multiple tasks in parallel using the worker pool.

        Falls back to sequential execution if no pool available.
        """
        if not self._worker_pool:
            results = []
            for task in tasks:
                engine = task.get("engine", "codex")
                await self.get_or_create_surface(engine)
                await self.inject_command(engine, task["description"])
                result = await self.collect_output(engine, timeout, task.get("id"))
                results.append(result)
            return results

        return await self._worker_pool.execute_batch(tasks, timeout)

    # ---- Browser workspace isolation ----

    async def create_utility_workspace(self, name: str = "clab-utility") -> str:
        """Create a utility workspace with terminal + browser surfaces.

        Terminal surface is used for file operations (prompt files, verification scripts).
        Browser surface is used for web verification.
        """
        if self._utility_workspace_id:
            return self._utility_workspace_id

        ws = await self.cmux.workspace_create(name[:40])
        self._utility_workspace_id = ws.get("id", ws.get("workspace_id"))

        # Create terminal surface for file operations
        surface = await self.cmux.surface_split("right", self._utility_workspace_id)
        self._utility_terminal_id = surface.get("surface_id", surface.get("id"))

        # Register in surface registry
        self.surfaces.register("utility-terminal", self._utility_terminal_id, "shell")

        # Initialize workdir prompt directory
        workdir = self._current_workdir or "."
        await self.cmux.send_text(self._utility_terminal_id, f"mkdir -p {workdir}/.clab/prompts")
        await asyncio.sleep(0.3)
        await self.cmux.send_key(self._utility_terminal_id, "enter")
        await asyncio.sleep(0.5)

        logger.info("Utility workspace created: %s (terminal: %s)", self._utility_workspace_id, self._utility_terminal_id)
        return self._utility_workspace_id

    async def browser_interact_isolated(self, url: str) -> dict:
        """Open browser in the isolated browser workspace."""
        ws_id = self._orchestrator_ws_id or self._utility_workspace_id or self.workspace_id
        if not self._browser:
            self._browser = CmuxBrowser(self.cmux, ws_id)
            await self._browser.open()

        await self._browser.navigate(url)
        await asyncio.sleep(1)
        snapshot = await self._browser.snapshot()
        return {
            "surface_id": self._browser.surface_id,
            "workspace_id": ws_id,
            "url": url,
            "snapshot": snapshot,
        }

    # ---- Cleanup ----

    async def release_surface(self, engine: str) -> None:
        """Close a specific engine's surface."""
        surface_id = self._engine_surfaces.pop(engine, None)
        if surface_id:
            try:
                await self.cmux.surface_close(surface_id)
            except Exception as exc:
                logger.debug("Failed to close surface %s: %s", surface_id, exc)
        if surface_id and surface_id in self._split_targets[1:]:
            self._split_targets = self._split_targets[:1]

    async def shutdown(self) -> None:
        """Reset runtime state. Workspace and surfaces are preserved for reuse."""
        if self._worker_pool:
            self._worker_pool = None

        if self._browser:
            await self._browser.close()
            self._browser = None

        self._engine_surfaces.clear()
        self.surfaces = SurfaceRegistry()
        self._split_targets = []

        if self._utility_terminal_id:
            try:
                await self.cmux.surface_close(self._utility_terminal_id)
            except Exception:
                pass
            self._utility_terminal_id = None
            self._utility_workspace_id = None

        logger.info("Runtime reset (workspace preserved): %s", self.workspace_id)
