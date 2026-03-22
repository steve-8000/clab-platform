"""Completion monitoring — notification-based and idle detection for cmux surfaces."""

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
    """Polls cmux surface output and notifications to detect task completion.

    Two strategies:
    - **Notification-first** (``wait_for_completion``): Primary signal is cmux
      notifications targeting the surface; idle detection is a secondary fallback.
    - **Idle-only** (``wait_for_idle`` with ``notification_first=False``): Legacy
      polling-based idle detection.
    """

    POLL_INTERVAL = 1.0
    NOTIFICATION_POLL_INTERVAL = 2.0
    IDLE_THRESHOLD = 8.0  # seconds of unchanged output before declaring idle

    def __init__(self, cmux_client) -> None:
        from .client import CmuxClient
        self.cmux: CmuxClient = cmux_client
        self._responded_prompts: dict[str, tuple[int, float]] = {}

    def reset_prompt_tracking(self, surface_id: str) -> None:
        self._responded_prompts.pop(surface_id, None)

    # ------------------------------------------------------------------
    # Primary entry point: notification-first, idle-fallback
    # ------------------------------------------------------------------

    async def wait_for_completion(
        self,
        surface_id: str,
        engine: str = "claude",
        timeout: float = 300,
        cancel_event: asyncio.Event | None = None,
    ) -> str:
        """Wait for task completion using notification-first, idle-fallback strategy.

        Primary: Poll ``notification_list`` for notifications targeting this
        *surface_id*.  When one is found the notification is cleared and the
        final surface output is returned.

        Secondary: While waiting for the notification, idle-pattern detection
        runs as a fallback (with the same double-check confirmation used by
        ``wait_for_idle``).

        Permission prompts are auto-responded to throughout.
        """
        pattern = _get_idle_pattern(engine)
        last_output = ""
        last_change_at = time.monotonic()
        start = time.monotonic()
        engine_started = False

        # Track when we last polled notifications (separate cadence)
        last_notification_poll = 0.0

        logger.info(
            "wait_for_completion: surface=%s engine=%s timeout=%.0f",
            surface_id, engine, timeout,
        )

        while time.monotonic() - start < timeout:
            if cancel_event and cancel_event.is_set():
                logger.debug("Completion wait cancelled for surface %s", surface_id)
                return last_output

            now = time.monotonic()

            # ---- PRIMARY: check notifications (every NOTIFICATION_POLL_INTERVAL) ----
            if now - last_notification_poll >= self.NOTIFICATION_POLL_INTERVAL:
                last_notification_poll = now
                if await self._check_notifications(surface_id):
                    logger.info(
                        "Completion detected via notification for surface %s",
                        surface_id,
                    )
                    # Clear the processed notifications
                    try:
                        await self.cmux.notification_clear()
                    except Exception:
                        logger.debug("Failed to clear notifications", exc_info=True)
                    # Read final output and return
                    final_output = await self.cmux.read_text(surface_id)
                    return final_output

            # ---- Read surface output (for prompts + idle fallback) ----
            output = await self.cmux.read_text(surface_id)

            if output != last_output:
                last_output = output
                last_change_at = time.monotonic()
                self._responded_prompts.pop(surface_id, None)
                await self._auto_respond_prompts(surface_id, output)

            # Don't check idle until engine has produced substantial output
            if not engine_started:
                if len(output.strip()) > 50:
                    engine_started = True
                    logger.debug("Engine started producing output (%d chars)", len(output))
                else:
                    await asyncio.sleep(self.POLL_INTERVAL)
                    continue

            # ---- SECONDARY: idle-pattern fallback ----
            tail = output[-1500:].rstrip()

            if pattern.search(tail):
                # For codex, also require footer pattern
                if engine == "codex" and not CODEX_FOOTER.search(tail):
                    if not CODEX_IDLE.search(tail):
                        await asyncio.sleep(self.POLL_INTERVAL)
                        continue
                # Double-check confirmation
                snapshot = output
                await asyncio.sleep(self.POLL_INTERVAL)
                confirm_output = await self.cmux.read_text(surface_id)
                confirm_tail = confirm_output[-1500:].rstrip()
                if confirm_output == snapshot and pattern.search(confirm_tail):
                    logger.info(
                        "Completion detected via idle pattern for surface %s (fallback)",
                        surface_id,
                    )
                    return confirm_output
                # Output changed — false positive; update and continue
                logger.debug(
                    "Idle false positive for %s — output changed during confirmation",
                    engine,
                )
                last_output = confirm_output
                last_change_at = time.monotonic()
                await self._auto_respond_prompts(surface_id, confirm_output)
                continue

            # Unchanged-output threshold (secondary fallback)
            elapsed_since_change = time.monotonic() - last_change_at
            if elapsed_since_change > self.IDLE_THRESHOLD and len(output) > 100:
                logger.info(
                    "Completion detected via idle threshold for surface %s "
                    "(no output change for %.1fs, fallback)",
                    surface_id, elapsed_since_change,
                )
                return output

            await asyncio.sleep(self.POLL_INTERVAL)

        logger.warning(
            "Timeout waiting for completion on surface %s after %.0fs",
            surface_id, timeout,
        )
        return last_output

    # ------------------------------------------------------------------
    # Notification helper
    # ------------------------------------------------------------------

    async def _check_notifications(self, surface_id: str) -> bool:
        """Check if any notification exists for this surface, indicating completion.

        Matches notifications where:
        - ``surface_id`` field matches exactly, OR
        - the notification title/body contains the surface_id string.
        """
        try:
            notifications = await self.cmux.notification_list()
        except Exception:
            logger.debug("Failed to poll notifications", exc_info=True)
            return False

        if not notifications:
            return False

        for notif in notifications:
            # Direct surface_id match
            if notif.get("surface_id") == surface_id:
                logger.debug(
                    "Notification matched surface_id=%s: %s", surface_id, notif,
                )
                return True
            # Fallback: check if surface_id appears in title or body
            title = notif.get("title", "")
            body = notif.get("body", "")
            if surface_id in title or surface_id in body:
                logger.debug(
                    "Notification matched surface_id=%s in title/body: %s",
                    surface_id, notif,
                )
                return True

        return False

    # ------------------------------------------------------------------
    # Legacy idle-only detection (kept as fallback / direct usage)
    # ------------------------------------------------------------------

    async def wait_for_idle(
        self,
        surface_id: str,
        engine: str = "claude",
        timeout: float = 300,
        cancel_event: asyncio.Event | None = None,
        notification_first: bool = True,
    ) -> str:
        """Wait until the engine appears idle, then return accumulated output.

        When *notification_first* is ``True`` (default), this delegates to
        ``wait_for_completion`` which uses notifications as the primary signal
        with idle detection as fallback.  Set to ``False`` to use the legacy
        pure-idle-polling behaviour.
        """
        if notification_first:
            return await self.wait_for_completion(
                surface_id=surface_id,
                engine=engine,
                timeout=timeout,
                cancel_event=cancel_event,
            )

        # --- Legacy idle-only path ---
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
                self._responded_prompts.pop(surface_id, None)
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

            # Check idle pattern with confirmation (double-check to avoid false positives)
            if pattern.search(tail):
                # For codex, also require footer pattern
                if engine == "codex" and not CODEX_FOOTER.search(tail):
                    if not CODEX_IDLE.search(tail):
                        await asyncio.sleep(self.POLL_INTERVAL)
                        continue
                # Confirmation check: wait one more interval and re-read
                # to ensure the output hasn't changed (guards against transient matches)
                snapshot = output
                await asyncio.sleep(self.POLL_INTERVAL)
                confirm_output = await self.cmux.read_text(surface_id)
                confirm_tail = confirm_output[-1500:].rstrip()
                if confirm_output == snapshot and pattern.search(confirm_tail):
                    logger.debug("Idle confirmed for %s (pattern match, double-check passed)", engine)
                    return confirm_output
                # Output changed — false positive; update state and continue loop
                logger.debug("Idle false positive for %s — output changed during confirmation", engine)
                last_output = confirm_output
                last_change_at = time.monotonic()
                await self._auto_respond_prompts(surface_id, confirm_output)
                continue

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

    # ------------------------------------------------------------------
    # Shell prompt / bypass detection (unchanged)
    # ------------------------------------------------------------------

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
        tail, _p = output[-800:], self._responded_prompts.get(surface_id)
        if _p and (len(output) == _p[0] or time.monotonic() - _p[1] < 5.0): return
        for pattern, response in PERMISSION_PROMPTS:
            if pattern.search(tail):
                logger.info("Auto-responding to permission prompt on surface %s", surface_id)
                await self.cmux.send_text(surface_id, response)
                self._responded_prompts[surface_id] = (len(output), time.monotonic())
                await asyncio.sleep(0.5)
                return  # only respond to one prompt at a time
