"""Completion monitoring — idle detection and output polling for cmux surfaces."""

from __future__ import annotations

import asyncio
import logging
import re
import time

logger = logging.getLogger(__name__)

# Idle detection patterns (ported from packages/engines/dist/*.js)
CLAUDE_IDLE = re.compile(r"(❯\s*$|claude[>\s]*$|waiting for input)", re.IGNORECASE | re.MULTILINE)
CODEX_IDLE = re.compile(r"(Codex\s*[>$]|waiting for input|█\s*$|› .*$)", re.IGNORECASE | re.MULTILINE)
CODEX_FOOTER = re.compile(r"gpt-\d(?:\.\d+)?", re.IGNORECASE)
SHELL_PROMPT = re.compile(r"[$#%>]\s*$", re.MULTILINE)
BYPASS_PROMPT = re.compile(r"Bypass Permissions mode", re.IGNORECASE)
ACCEPT_CHOICE = re.compile(r"Yes, I accept", re.IGNORECASE)

# Permission prompts that agents must auto-accept for autonomous operation
PERMISSION_PROMPTS = [
    # Claude Code: MCP tool usage ("Do you want to proceed? 1. Yes / 2. Yes, and don't ask again / 3. No")
    (re.compile(r"Do you want to proceed\?\s*\n.*?1\.\s*Yes", re.DOTALL), "1\n"),
    # Claude Code: file edit ("Do you want to make this edit to ...? 1. Yes / 2. Yes, and allow ...")
    (re.compile(r"Do you want to make this edit to .+\?\s*\n.*?1\.\s*Yes", re.DOTALL), "1\n"),
    # Claude Code: bash command ("Do you want to run this command?")
    (re.compile(r"Do you want to run this command\?\s*\n.*?1\.\s*Yes", re.DOTALL), "1\n"),
    # Claude Code: settings edit
    (re.compile(r"Do you want to make this edit to settings\.json\?", re.IGNORECASE), "2\n"),
    # Codex: approval prompt
    (re.compile(r"approve\?\s*\[y/N\]", re.IGNORECASE), "y\n"),
    # Generic yes/no
    (re.compile(r"\[Y/n\]\s*$", re.MULTILINE), "Y\n"),
    (re.compile(r"\[y/N\]\s*$", re.MULTILINE), "y\n"),
    # Bypass Permissions (handled separately but included for completeness)
    (re.compile(r"Bypass Permissions mode.*Yes, I accept", re.DOTALL | re.IGNORECASE), "2\n"),
    # Claude asking design/planning questions ("Should I...", "Would you like me to...", "Do you want me to...")
    (re.compile(r"(?:Should I|Would you like me to|Do you want me to|Shall I|Can I proceed|proceed\?)\s*$", re.IGNORECASE | re.MULTILINE), "Yes, proceed with your best judgment.\n"),
    # Claude asking for choice between approaches
    (re.compile(r"Which (?:approach|option|method|way) (?:should|would|do)", re.IGNORECASE), "Use the simplest approach and proceed.\n"),
]


def _get_idle_pattern(engine: str) -> re.Pattern:
    if engine == "claude":
        return CLAUDE_IDLE
    elif engine == "codex":
        return CODEX_IDLE
    return SHELL_PROMPT


class CompletionMonitor:
    """Polls cmux surface output to detect task completion."""

    POLL_INTERVAL = 1.0
    IDLE_THRESHOLD = 8.0  # seconds of unchanged output before declaring idle

    def __init__(self, cmux_client) -> None:
        from .client import CmuxClient
        self.cmux: CmuxClient = cmux_client

    async def wait_for_idle(
        self,
        surface_id: str,
        engine: str = "claude",
        timeout: float = 300,
        cancel_event: asyncio.Event | None = None,
    ) -> str:
        """Wait until the engine appears idle, then return accumulated output."""
        pattern = _get_idle_pattern(engine)
        last_output = ""
        last_change_at = time.monotonic()
        start = time.monotonic()

        # Phase 1: Wait for engine to actually start (produce meaningful output)
        engine_started = False
        while time.monotonic() - start < timeout:
            if cancel_event and cancel_event.is_set():
                logger.debug("Idle wait cancelled for surface %s", surface_id)
                return last_output

            output = await self.cmux.read_text(surface_id)

            if output != last_output:
                last_output = output
                last_change_at = time.monotonic()

                # Auto-respond to any permission prompts (autonomous agent mode)
                await self._auto_respond_prompts(surface_id, output)

            # Don't check idle until engine has produced substantial output
            if not engine_started:
                if len(output.strip()) > 50:
                    engine_started = True
                    logger.debug("Engine started producing output (%d chars)", len(output))
                else:
                    await asyncio.sleep(self.POLL_INTERVAL)
                    continue

            tail = output[-1500:].rstrip()

            # Check idle pattern
            if pattern.search(tail):
                # For codex, also require footer pattern
                if engine == "codex" and not CODEX_FOOTER.search(tail):
                    if not CODEX_IDLE.search(tail):
                        await asyncio.sleep(self.POLL_INTERVAL)
                        continue
                logger.debug("Idle detected for %s (pattern match)", engine)
                return output

            # If output hasn't changed for IDLE_THRESHOLD, consider it done
            elapsed_since_change = time.monotonic() - last_change_at
            if elapsed_since_change > self.IDLE_THRESHOLD and len(output) > 100:
                logger.debug(
                    "Idle detected for %s (no output change for %.1fs)",
                    engine,
                    elapsed_since_change,
                )
                return output

            await asyncio.sleep(self.POLL_INTERVAL)

        logger.warning("Timeout waiting for idle on surface %s after %.0fs", surface_id, timeout)
        return last_output

    async def wait_for_shell_prompt(
        self,
        surface_id: str,
        timeout: float = 60,
    ) -> str:
        """Wait for a shell prompt to appear (used after running verification commands)."""
        last_output = ""
        last_change_at = time.monotonic()
        start = time.monotonic()

        while time.monotonic() - start < timeout:
            output = await self.cmux.read_text(surface_id)

            if output != last_output:
                last_output = output
                last_change_at = time.monotonic()

            tail = output[-500:].rstrip()
            if SHELL_PROMPT.search(tail):
                return output

            if time.monotonic() - last_change_at > 5.0 and len(output) > 50:
                return output

            await asyncio.sleep(0.5)

        return last_output

    async def detect_bypass_prompt(self, surface_id: str, timeout: float = 5) -> bool:
        """Check if Claude's 'Bypass Permissions' prompt is showing."""
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            output = await self.cmux.read_text(surface_id)
            if BYPASS_PROMPT.search(output) and ACCEPT_CHOICE.search(output):
                return True
            await asyncio.sleep(0.3)
        return False

    async def _auto_respond_prompts(self, surface_id: str, output: str) -> None:
        """Detect and auto-respond to permission prompts for autonomous operation.

        When an agent runs inside a cmux surface, it must never block on
        human confirmation. This method checks the last portion of output
        for known permission prompt patterns and sends the appropriate response.
        """
        tail = output[-800:]
        for pattern, response in PERMISSION_PROMPTS:
            if pattern.search(tail):
                logger.info("Auto-responding to permission prompt on surface %s", surface_id)
                await self.cmux.send_text(surface_id, response)
                await asyncio.sleep(0.5)
                return  # only respond to one prompt at a time
