"""Human-in-the-loop interrupt handling via Control Plane HTTP API."""
from __future__ import annotations
import asyncio
import httpx
import logging

logger = logging.getLogger(__name__)


class InterruptHandler:
    """Handle human-in-the-loop interrupts via Control Plane API.

    When a LangGraph node needs human input:
    1. Posts interrupt to Control Plane
    2. Polls until interrupt is resolved
    3. Returns the resume value
    """

    def __init__(self, control_plane_url: str, poll_interval: float = 2.0, timeout: float = 3600.0):
        self.url = control_plane_url.rstrip("/")
        self.poll_interval = poll_interval
        self.timeout = timeout

    async def request_input(self, session_id: str, question: str) -> str:
        """Request human input via Control Plane interrupt API.

        Blocks until the interrupt is resolved (via dashboard/API).
        """
        async with httpx.AsyncClient(timeout=30) as client:
            # Create interrupt
            resp = await client.post(f"{self.url}/interrupts", json={
                "session_id": session_id,
                "thread_id": session_id,
                "value": question,
            })
            resp.raise_for_status()
            interrupt = resp.json()
            interrupt_id = interrupt["id"]

            logger.info(f"Interrupt created: {interrupt_id} — waiting for resolution...")

            # Poll for resolution
            elapsed = 0.0
            while elapsed < self.timeout:
                await asyncio.sleep(self.poll_interval)
                elapsed += self.poll_interval

                resp = await client.get(f"{self.url}/interrupts/{interrupt_id}")
                resp.raise_for_status()
                data = resp.json()

                if data.get("status") == "resolved":
                    resume_value = data.get("resume_value", "")
                    logger.info(f"Interrupt {interrupt_id} resolved: {resume_value[:100]}")
                    return resume_value

            raise TimeoutError(f"Interrupt {interrupt_id} not resolved within {self.timeout}s")
