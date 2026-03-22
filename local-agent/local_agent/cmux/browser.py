"""cmux built-in browser wrapper — replaces Playwright with cmux's agent-browser API."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class CmuxBrowser:
    """High-level browser automation using cmux's agent-browser port.

    Provides snapshot/click/fill/eval operations on cmux's built-in WKWebView browser,
    replacing the need for Playwright or Puppeteer.
    """

    def __init__(self, cmux_client, workspace_id: str) -> None:
        from .client import CmuxClient
        self.cmux: CmuxClient = cmux_client
        self.workspace_id = workspace_id
        self.surface_id: str | None = None

    async def open(self, url: str = "about:blank") -> str:
        """Open a browser split pane and navigate to url."""
        result = await self.cmux.browser_open(self.workspace_id, url)
        self.surface_id = result.get("surface_id", result.get("id"))
        logger.info("Browser opened: surface=%s url=%s", self.surface_id, url)
        return self.surface_id

    def _ensure_surface(self) -> str:
        if not self.surface_id:
            raise RuntimeError("Browser not opened — call open() first")
        return self.surface_id

    async def navigate(self, url: str) -> dict:
        """Navigate to a URL."""
        return await self.cmux.browser_navigate(self._ensure_surface(), url)

    async def snapshot(self) -> dict:
        """Get accessibility tree snapshot — the primary way LLMs understand page structure."""
        return await self.cmux.browser_snapshot(self._ensure_surface())

    async def click(self, ref: str) -> dict:
        """Click an element by its ref handle (from snapshot)."""
        return await self.cmux.browser_click(self._ensure_surface(), ref)

    async def fill(self, ref: str, text: str) -> dict:
        """Fill a form field by ref."""
        return await self.cmux.browser_fill(self._ensure_surface(), ref, text)

    async def evaluate(self, expression: str) -> dict:
        """Evaluate JavaScript in the browser context."""
        return await self.cmux.browser_eval(self._ensure_surface(), expression)

    async def screenshot(self) -> dict:
        """Take a screenshot of the browser surface."""
        return await self.cmux.browser_screenshot(self._ensure_surface())

    async def back(self) -> dict:
        return await self.cmux.browser_back(self._ensure_surface())

    async def forward(self) -> dict:
        return await self.cmux.browser_forward(self._ensure_surface())

    async def reload(self) -> dict:
        return await self.cmux.browser_reload(self._ensure_surface())

    async def wait_for(self, selector: str, timeout: int = 10000) -> dict:
        """Wait for a selector to appear on the page."""
        return await self.cmux.request("browser.wait", {
            "surface_id": self._ensure_surface(),
            "selector": selector,
            "timeout": timeout,
        })

    async def get_text(self, ref: str) -> str:
        """Get text content of an element."""
        result = await self.cmux.request("browser.get.text", {
            "surface_id": self._ensure_surface(),
            "ref": ref,
        })
        return result.get("text", "")

    async def get_url(self) -> str:
        """Get current page URL."""
        result = await self.cmux.request("browser.url.get", {
            "surface_id": self._ensure_surface(),
        })
        return result.get("url", "")

    async def is_visible(self, ref: str) -> bool:
        """Check if an element is visible."""
        result = await self.cmux.request("browser.is.visible", {
            "surface_id": self._ensure_surface(),
            "ref": ref,
        })
        return result.get("visible", False)

    async def close(self) -> None:
        """Close the browser surface."""
        if self.surface_id:
            await self.cmux.surface_close(self.surface_id)
            self.surface_id = None
