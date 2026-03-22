"""Worker and WorkerPool — multi-worker parallel execution for cmux runtime.

Architecture:
  WorkerPool manages N Codex workers + 1 Codex reviewer within a single workspace.
  Workers execute tasks in parallel, then each result goes through ReviewLoop.
  ReviewLoop uses the Codex reviewer surface to approve or request fixes.

  Surface layout:
    main (top-left) → codex-reviewer
    right split from main → codex-worker-0
    down split from main → codex-worker-1
    down split from worker-0 → codex-worker-2
"""

from __future__ import annotations

import asyncio
import enum
import os
import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .client import CmuxClient
from .monitor import CompletionMonitor
# TaskResult and AUTONOMOUS_DIRECTIVE are imported lazily to avoid circular imports
# (executor.py imports WorkerPool from this module)

if TYPE_CHECKING:
    from .executor import TaskResult

logger = logging.getLogger(__name__)


async def _get_git_diff(workdir: str, files: list[str] | None = None) -> str:
    """Get git diff scoped to specific files (or full working tree if none specified)."""
    import subprocess

    try:
        cmd = ["git", "diff", "HEAD"]
        if files:
            cmd.append("--")
            cmd.extend(files)
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=10, cwd=workdir,
        )
        diff = result.stdout.strip()
        if not diff and not files:
            result = subprocess.run(
                ["git", "diff"],
                capture_output=True, text=True, timeout=10, cwd=workdir,
            )
            diff = result.stdout.strip()
        return diff if diff else "(no changes detected)"
    except Exception as e:
        return f"(git diff failed: {e})"


class WorkerState(enum.Enum):
    IDLE = "idle"
    RUNNING = "running"
    REVIEWING = "reviewing"
    FIXING = "fixing"


@dataclass
class Worker:
    """A single execution worker owning one cmux surface."""

    worker_id: int
    surface_id: str
    engine: str  # "codex" or "claude"
    monitor: CompletionMonitor
    cmux: CmuxClient
    state: WorkerState = WorkerState.IDLE
    current_task: dict | None = None
    _engine_started: bool = False

    async def start_engine(self, workdir: str, system_prompt: str = "") -> None:
        """Launch the engine CLI in this worker's surface (one-time)."""
        from .executor import AUTONOMOUS_DIRECTIVE

        if self._engine_started:
            return

        await self.cmux.send_text(self.surface_id, f"cd {workdir}\n")
        await asyncio.sleep(0.5)

        if self.engine == "codex":
            await self.cmux.send_text(self.surface_id, "codex")
            await asyncio.sleep(1.0)
            await self.cmux.send_key(self.surface_id, "enter")
            # Wait for codex TUI to be ready (detect idle prompt instead of blind sleep)
            await self._wait_for_engine_ready(timeout=15)

        elif self.engine == "claude":
            full_prompt = (
                f"{AUTONOMOUS_DIRECTIVE}\n\n{system_prompt}"
                if system_prompt
                else AUTONOMOUS_DIRECTIVE
            )
            escaped = full_prompt.replace("'", "'\\''")
            cmd_parts = [
                "claude",
                "--dangerously-skip-permissions",
                "--allowedTools",
                "'*'",
            ]
            if escaped:
                cmd_parts.extend(["--append-system-prompt", f"'{escaped}'"])
            await self.cmux.send_text(self.surface_id, " ".join(cmd_parts))
            await asyncio.sleep(1.0)
            await self.cmux.send_key(self.surface_id, "enter")
            await asyncio.sleep(3)

            if await self.monitor.detect_bypass_prompt(self.surface_id, timeout=5):
                await self.cmux.send_text(self.surface_id, "2")
                await self.cmux.send_key(self.surface_id, "Enter")
                await asyncio.sleep(1)

        self._engine_started = True
        logger.info(
            "Worker-%d: engine %s started on surface %s",
            self.worker_id,
            self.engine,
            self.surface_id,
        )

    async def _wait_for_engine_ready(self, timeout: float = 15) -> None:
        """Wait until engine TUI shows idle prompt (› for codex, ❯ for claude)."""
        import time as _time

        start = _time.monotonic()
        while _time.monotonic() - start < timeout:
            output = await self.cmux.read_text(self.surface_id)
            tail = output[-500:] if output else ""
            # Codex ready: shows "›" prompt with model info footer
            if self.engine == "codex" and "›" in tail and "gpt-" in tail.lower():
                logger.debug("Worker-%d: codex TUI ready", self.worker_id)
                return
            # Claude ready: shows "❯" prompt
            if self.engine == "claude" and "❯" in tail:
                logger.debug("Worker-%d: claude TUI ready", self.worker_id)
                return
            await asyncio.sleep(1.0)
        logger.warning(
            "Worker-%d: engine ready timeout after %.0fs, proceeding anyway",
            self.worker_id,
            timeout,
        )

    @staticmethod
    def _write_prompt_file(instruction: str) -> str:
        """Write long prompt to project-local file, return reference instruction."""
        prompt_id = uuid.uuid4().hex[:8]
        base_dir = os.getcwd()
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

    async def inject_and_collect(
        self,
        instruction: str,
        timeout: float = 300,
        task_id: str | None = None,
    ) -> TaskResult:
        """Inject instruction and wait for idle.

        For long prompts (>2000 chars), writes to a temp file to avoid TUI truncation.
        """
        from .executor import TaskResult

        self.state = WorkerState.RUNNING
        self.monitor.reset_prompt_tracking(self.surface_id)

        # For long prompts, write to temp file to avoid TUI input buffer truncation
        if len(instruction) > 2000:
            instruction = self._write_prompt_file(instruction)

        await self.cmux.send_text(self.surface_id, instruction)
        await asyncio.sleep(1.0)
        await self.cmux.send_key(self.surface_id, "enter")

        idle_detected = True
        try:
            output = await self.monitor.wait_for_idle(
                self.surface_id, self.engine, timeout=timeout
            )
        except TimeoutError:
            output = await self.cmux.read_text(self.surface_id)
            idle_detected = False

        self.state = WorkerState.IDLE
        return TaskResult(
            output=output,
            surface_id=self.surface_id,
            engine=self.engine,
            idle_detected=idle_detected,
            task_id=task_id,
        )

    async def read_current_output(self) -> str:
        return await self.cmux.read_text(self.surface_id)


@dataclass
class ReviewResult:
    """Result from the Codex reviewer."""

    approved: bool
    feedback: str  # empty if approved, fix instructions if not
    task_id: str


class ReviewLoop:
    """Manages the Codex reviewer and the review-fix-re-review cycle.

    Uses asyncio.Lock because the single Codex reviewer surface can only
    process one review at a time.
    """

    MAX_FIX_ROUNDS = 2
    _DESCRIPTION_LIMIT = 200
    _PROMPT_FILE_RE = re.compile(r"Execute the instructions in (\S+?\.md) now", re.IGNORECASE)

    def __init__(self, reviewer_worker: Worker, workdir: str = "") -> None:
        self.reviewer = reviewer_worker
        self._workdir = workdir
        self._review_lock = asyncio.Lock()

    async def review(self, task: dict, worker_output: str, git_diff: str = "") -> ReviewResult:
        """Send task output to reviewer and get approval/fix decision."""
        async with self._review_lock:
            prompt = self._build_review_prompt(task, worker_output, git_diff)
            result = await self.reviewer.inject_and_collect(
                prompt, timeout=120, task_id=task.get("id")
            )
            return self._parse_review_result(result.output, task.get("id", ""))

    async def review_and_fix(
        self,
        task: dict,
        worker: Worker,
        initial_output: str,
        git_diff: str = "",
    ) -> tuple[ReviewResult, str]:
        """Full review loop: review -> (fix -> re-review)* until approved or max rounds."""
        output = initial_output

        for round_num in range(self.MAX_FIX_ROUNDS + 1):
            review_result = await self.review(task, output, git_diff)

            if review_result.approved:
                logger.info(
                    "Task %s approved by reviewer (round %d)",
                    task.get("id"),
                    round_num,
                )
                return review_result, output

            if round_num >= self.MAX_FIX_ROUNDS:
                logger.warning(
                    "Task %s: max fix rounds reached, accepting as-is",
                    task.get("id"),
                )
                review_result.approved = True
                return review_result, output

            # Inject fix instruction into the worker
            logger.info(
                "Task %s: fix round %d — injecting fix instruction",
                task.get("id"),
                round_num + 1,
            )
            worker.state = WorkerState.FIXING
            fix_result = await worker.inject_and_collect(
                review_result.feedback, timeout=300, task_id=task.get("id")
            )
            output = fix_result.output
            # Re-fetch git diff after fix
            if self._workdir:
                git_diff = await _get_git_diff(self._workdir)

        # Should not reach here, but just in case
        return ReviewResult(approved=True, feedback="", task_id=task.get("id", "")), output

    def _build_review_prompt(self, task: dict, output: str, git_diff: str = "") -> str:
        review_content = git_diff if git_diff and git_diff != "(no changes detected)" else output[-1500:]
        truncated = review_content[-2000:] if len(review_content) > 2000 else review_content
        description = self._summarize_task_description(task.get("description", ""))
        return (
            f"Review this task completion.\n\n"
            f"Task: {task.get('title', '')}\n"
            f"Description: {description}\n\n"
            f"Changes:\n---\n{truncated}\n---\n\n"
            f"Respond with APPROVED if the task goal was addressed by the changes.\n"
            f"IGNORE any unrelated changes in the diff — only judge the task-specific work.\n"
            f"Respond with FIX: <instructions> ONLY if the task-specific changes have a clear bug.\n"
            f"When in doubt, respond APPROVED."
        )

    def _summarize_task_description(self, description: str) -> str:
        text = description.strip()
        prompt_path = self._extract_prompt_path(text)
        if prompt_path:
            prompt_excerpt = self._read_prompt_excerpt(prompt_path)
            if prompt_excerpt:
                text = f"Prompt file {prompt_path}: {prompt_excerpt}"
        normalized = " ".join(text.split())
        if len(normalized) <= self._DESCRIPTION_LIMIT:
            return normalized
        return normalized[: self._DESCRIPTION_LIMIT - 3].rstrip() + "..."

    def _extract_prompt_path(self, description: str) -> str | None:
        match = self._PROMPT_FILE_RE.search(description)
        if not match:
            return None
        return match.group(1)

    def _read_prompt_excerpt(self, prompt_path: str) -> str:
        try:
            content = Path(prompt_path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return ""
        return content.strip()

    def _parse_review_result(self, output: str, task_id: str) -> ReviewResult:
        tail = output[-1500:].strip()

        if "APPROVED" in tail.upper():
            return ReviewResult(approved=True, feedback="", task_id=task_id)

        fix_match = re.search(r"FIX:\s*(.+)", tail, re.DOTALL | re.IGNORECASE)
        if fix_match:
            return ReviewResult(approved=False, feedback=fix_match.group(1).strip(), task_id=task_id)

        # No explicit FIX found - default to APPROVED (lenient)
        logger.info("No explicit APPROVED or FIX in review output, defaulting to APPROVED")
        return ReviewResult(approved=True, feedback="", task_id=task_id)


class WorkerPool:
    """Pool of N Codex workers + 1 Codex reviewer.

    Surface layout within one workspace:
      reviewer occupies main surface (top-left)
      right split → codex-worker-0
      down splits → codex-worker-1, codex-worker-2
    """

    def __init__(
        self,
        cmux: CmuxClient,
        workspace_id: str,
        num_workers: int = 3,
        registry: Any | None = None,
        reviewer_engine_started: bool = False,
        reviewer_surface_id: str | None = None,
    ) -> None:
        self.cmux = cmux
        self.workspace_id = workspace_id
        self.num_workers = num_workers
        self._registry = registry  # SurfaceRegistry from CmuxRuntime
        self._reviewer_engine_started = reviewer_engine_started
        self._reviewer_surface_id = reviewer_surface_id
        self.workers: list[Worker] = []
        self.reviewer: Worker | None = None
        self.review_loop: ReviewLoop | None = None
        self._workdir = ""
        self._initialized = False

    async def initialize(self, workdir: str, system_prompt: str = "") -> None:
        """Create all surfaces and start engines."""
        if self._initialized:
            return
        self._workdir = workdir

        surfaces = await self.cmux.surface_list(self.workspace_id)
        main_surface_id = surfaces[0].get("surface_id", surfaces[0].get("id")) if surfaces else None
        if not main_surface_id:
            raise RuntimeError("No main surface found for workspace")

        # Reviewer gets the main surface (top-left, largest area)
        if self._reviewer_surface_id:
            reviewer_surface_id = self._reviewer_surface_id
            logger.info("Reviewer reusing planner codex surface: %s", reviewer_surface_id)
        else:
            reviewer_surface_id = main_surface_id

        # Split anchor is always reviewer surface (planner's codex = main surface now)
        split_anchor = reviewer_surface_id
        try:
            await self.cmux.request(
                "surface.rename",
                {"surface_id": reviewer_surface_id, "name": "codex-reviewer"},
            )
        except Exception:
            pass

        # Split workers from reviewer surface (balanced 2-column grid)
        # Step 1: reviewer → split right → w0
        surface_0 = await self.cmux.surface_split("right", self.workspace_id, split_anchor)
        w0_id = surface_0.get("surface_id", surface_0.get("id"))

        # Step 2: reviewer → split down → w1
        surface_1 = await self.cmux.surface_split("down", self.workspace_id, split_anchor)
        w1_id = surface_1.get("surface_id", surface_1.get("id"))

        # Step 3: w0 → split down → w2
        surface_2 = await self.cmux.surface_split("down", self.workspace_id, w0_id)
        w2_id = surface_2.get("surface_id", surface_2.get("id"))

        worker_surface_ids = [w0_id, w1_id, w2_id]

        # Create codex worker surfaces
        for i, surface_id in enumerate(worker_surface_ids[:self.num_workers]):
            monitor = CompletionMonitor(self.cmux)
            worker = Worker(
                worker_id=i,
                surface_id=surface_id,
                engine="codex",
                monitor=monitor,
                cmux=self.cmux,
            )
            self.workers.append(worker)

            if self._registry:
                self._registry.register(f"codex-worker-{i}", surface_id, "codex")

            try:
                await self.cmux.request(
                    "surface.rename",
                    {"surface_id": surface_id, "name": f"codex-worker-{i}"},
                )
            except Exception:
                pass

        # Reviewer on main surface (already allocated above)
        reviewer_monitor = CompletionMonitor(self.cmux)
        self.reviewer = Worker(
            worker_id=-1,
            surface_id=reviewer_surface_id,
            engine="codex",
            monitor=reviewer_monitor,
            cmux=self.cmux,
        )
        self.review_loop = ReviewLoop(self.reviewer, workdir=workdir)

        if self._registry:
            self._registry.register(
                "codex-reviewer", reviewer_surface_id, "codex", owned=False
            )

        # Start all engines in parallel
        start_tasks = [w.start_engine(workdir) for w in self.workers]
        if not self._reviewer_engine_started:
            start_tasks.append(self.reviewer.start_engine(workdir))
        else:
            self.reviewer._engine_started = True
        await asyncio.gather(*start_tasks)

        # Rename workspace after all engines started (prevents cmux title override)
        try:
            await self.cmux.request("workspace.rename", {
                "workspace_id": self.workspace_id,
                "name": "agent-workers",
            })
        except Exception:
            pass

        self._initialized = True
        logger.info(
            "WorkerPool initialized: %d workers + 1 reviewer", self.num_workers
        )

    async def execute_batch(
        self,
        tasks: list[dict],
        timeout: float = 300,
    ) -> list[TaskResult]:
        """Execute a batch of tasks in parallel across workers.

        If len(tasks) > num_workers, executes in sub-batches.
        Each completed task goes through review loop.
        """
        results: list[TaskResult | None] = [None] * len(tasks)

        for batch_start in range(0, len(tasks), self.num_workers):
            batch_end = min(batch_start + self.num_workers, len(tasks))
            batch = tasks[batch_start:batch_end]

            async def _run_with_review(
                worker: Worker, task: dict, result_idx: int
            ) -> None:
                from .executor import TaskResult

                task_result = await worker.inject_and_collect(
                    task["description"], timeout=timeout, task_id=task.get("id")
                )

                if self.review_loop and task_result.idle_detected:
                    git_diff = await _get_git_diff(self._workdir)
                    _review_result, final_output = (
                        await self.review_loop.review_and_fix(
                            task, worker, task_result.output, git_diff=git_diff
                        )
                    )
                    task_result = TaskResult(
                        output=final_output,
                        surface_id=task_result.surface_id,
                        engine=task_result.engine,
                        idle_detected=task_result.idle_detected,
                        task_id=task_result.task_id,
                    )

                results[result_idx] = task_result

            async with asyncio.TaskGroup() as tg:
                for i, task in enumerate(batch):
                    worker = self.workers[i]
                    tg.create_task(
                        _run_with_review(worker, task, batch_start + i)
                    )

        return results  # type: ignore[return-value]

    def get_idle_workers(self) -> list[Worker]:
        return [w for w in self.workers if w.state == WorkerState.IDLE]

    async def shutdown(self) -> None:
        """Close all worker and reviewer surfaces."""
        for worker in self.workers:
            try:
                await self.cmux.surface_close(worker.surface_id)
            except Exception as exc:
                logger.debug(
                    "Failed to close worker-%d: %s", worker.worker_id, exc
                )

        if self.reviewer:
            # Reviewer uses main surface — do not close it
            pass

        self.workers.clear()
        self.reviewer = None
        self.review_loop = None
        self._initialized = False
