"""cmux v2 JSON-RPC socket client for Python asyncio."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_SOCKET_PATH = str(
    Path.home() / "Library" / "Application Support" / "cmux" / "cmux.sock"
)
REQUEST_TIMEOUT = 10.0


class CmuxError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(f"cmux error ({code}): {message}")


class CmuxClient:
    """Async client for the cmux v2 JSON-RPC socket API."""

    def __init__(self) -> None:
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[dict]] = {}
        self._recv_task: asyncio.Task | None = None
        self._raw_buffer = b""
        self._request_lock = asyncio.Lock()
        self._conn_lock = asyncio.Lock()

    async def connect(self, socket_path: str | None = None) -> None:
        async with self._conn_lock:
            path = socket_path or os.environ.get("CMUX_SOCKET_PATH", DEFAULT_SOCKET_PATH)
            self._reader, self._writer = await asyncio.open_unix_connection(path)
            self._recv_task = asyncio.create_task(self._receive_loop())
            logger.info("Connected to cmux at %s", path)

    async def disconnect(self) -> None:
        async with self._conn_lock:
            if self._recv_task:
                self._recv_task.cancel()
                self._recv_task = None
            if self._writer:
                self._writer.close()
                await self._writer.wait_closed()
                self._writer = None
            self._reader = None
            for fut in self._pending.values():
                if not fut.done():
                    fut.cancel()
            self._pending.clear()

    async def request(self, method: str, params: dict[str, Any] | None = None) -> dict:
        if not self._writer:
            raise RuntimeError("Not connected to cmux — call connect() first")

        async with self._request_lock:
            req_id = self._next_id
            self._next_id += 1
            payload = {"id": req_id, "method": method, "params": params or {}}
            line = json.dumps(payload, separators=(",", ":")) + "\n"
            self._writer.write(line.encode())
            await self._writer.drain()
            future: asyncio.Future[dict] = asyncio.get_event_loop().create_future()
            self._pending[req_id] = future

        try:
            return await asyncio.wait_for(future, timeout=REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise TimeoutError(f"cmux request timed out: {method}")

    async def _receive_loop(self) -> None:
        try:
            while self._reader:
                data = await self._reader.read(65536)
                if not data:
                    break
                self._raw_buffer += data
                while b"\n" in self._raw_buffer:
                    raw_line, self._raw_buffer = self._raw_buffer.split(b"\n", 1)
                    line = raw_line.decode("utf-8", errors="replace")
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning("Invalid JSON from cmux: %s", line[:200])
                        continue
                    req_id = msg.get("id")
                    if req_id is not None and req_id in self._pending:
                        fut = self._pending.pop(req_id)
                        if msg.get("ok") is False or msg.get("error"):
                            err = msg.get("error", {})
                            fut.set_exception(
                                CmuxError(err.get("code", "unknown"), err.get("message", "unknown error"))
                            )
                        else:
                            fut.set_result(msg.get("result", {}))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("cmux receive loop error: %s", exc)
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(exc)
            self._pending.clear()

    # ---- Workspace ----
    async def workspace_create(self, name: str = "") -> dict:
        params = {"name": name} if name else {}
        return await self.request("workspace.create", params)

    async def workspace_list(self) -> list[dict]:
        result = await self.request("workspace.list")
        return result.get("workspaces", result if isinstance(result, list) else [])

    async def workspace_select(self, workspace_id: str) -> None:
        await self.request("workspace.select", {"workspace_id": workspace_id})

    async def workspace_current(self) -> dict:
        return await self.request("workspace.current")

    async def workspace_rename(self, name: str, workspace_id: str | None = None) -> None:
        params = {"name": name}
        if workspace_id:
            params["workspace_id"] = workspace_id
        await self.request("workspace.rename", params)

    # ---- Surface ----
    async def surface_create(self, workspace_id: str | None = None) -> dict:
        params = {}
        if workspace_id:
            params["workspace_id"] = workspace_id
        return await self.request("surface.create", params)

    async def surface_split(self, direction: str = "right", workspace_id: str | None = None, surface_id: str | None = None) -> dict:
        params = {"direction": direction}
        if workspace_id:
            params["workspace_id"] = workspace_id
        if surface_id:
            params["surface_id"] = surface_id
        return await self.request("surface.split", params)

    async def surface_list(self, workspace_id: str | None = None) -> list[dict]:
        params = {}
        if workspace_id:
            params["workspace_id"] = workspace_id
        result = await self.request("surface.list", params)
        return result.get("surfaces", result if isinstance(result, list) else [])

    async def surface_close(self, surface_id: str) -> None:
        await self.request("surface.close", {"surface_id": surface_id})

    async def surface_focus(self, surface_id: str) -> None:
        await self.request("surface.focus", {"surface_id": surface_id})

    # ---- Terminal I/O ----
    async def send_text(self, surface_id: str, text: str) -> None:
        await self.request("surface.send_text", {"surface_id": surface_id, "text": text})

    async def send_key(self, surface_id: str, key: str) -> None:
        await self.request("surface.send_key", {"surface_id": surface_id, "key": key})

    async def read_text(self, surface_id: str) -> str:
        result = await self.request("surface.read_text", {"surface_id": surface_id})
        return result.get("text", "")

    # ---- Browser (agent-browser API) ----
    async def browser_open(self, workspace_id: str, url: str = "about:blank") -> dict:
        return await self.request("browser.open_split", {"workspace_id": workspace_id, "url": url})

    async def browser_navigate(self, surface_id: str, url: str) -> dict:
        return await self.request("browser.navigate", {"surface_id": surface_id, "url": url})

    async def browser_snapshot(self, surface_id: str) -> dict:
        return await self.request("browser.snapshot", {"surface_id": surface_id})

    async def browser_click(self, surface_id: str, ref: str) -> dict:
        return await self.request("browser.click", {"surface_id": surface_id, "ref": ref})

    async def browser_fill(self, surface_id: str, ref: str, text: str) -> dict:
        return await self.request("browser.fill", {"surface_id": surface_id, "ref": ref, "text": text})

    async def browser_eval(self, surface_id: str, expression: str) -> dict:
        return await self.request("browser.eval", {"surface_id": surface_id, "expression": expression})

    async def browser_screenshot(self, surface_id: str) -> dict:
        return await self.request("browser.screenshot", {"surface_id": surface_id})

    async def browser_back(self, surface_id: str) -> dict:
        return await self.request("browser.back", {"surface_id": surface_id})

    async def browser_forward(self, surface_id: str) -> dict:
        return await self.request("browser.forward", {"surface_id": surface_id})

    async def browser_reload(self, surface_id: str) -> dict:
        return await self.request("browser.reload", {"surface_id": surface_id})

    # ---- Notifications ----
    async def notify(self, title: str, body: str = "", surface_id: str | None = None) -> None:
        params: dict[str, Any] = {"title": title, "body": body}
        if surface_id:
            method = "notification.create_for_surface"
            params["surface_id"] = surface_id
        else:
            method = "notification.create"
        await self.request(method, params)

    async def notification_list(self) -> list[dict]:
        result = await self.request("notification.list")
        return result.get("notifications", result if isinstance(result, list) else [])

    async def notification_clear(self) -> None:
        await self.request("notification.clear")

    # ---- System ----
    async def identify(self) -> dict:
        return await self.request("system.identify")

    async def ping(self) -> dict:
        return await self.request("system.ping")
