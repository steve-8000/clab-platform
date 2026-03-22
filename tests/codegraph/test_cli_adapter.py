"""Tests for CgcCliEngineAdapter."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from codegraph.cli_adapter import CgcCliEngineAdapter


@pytest.fixture
def adapter():
    return CgcCliEngineAdapter(
        cgc_binary_path="/usr/bin/cgc",
        timeout_index=10,
        timeout_query=5,
    )


# ── _run_cgc ──────────────────────────────────────────────────────


class TestRunCgc:
    @pytest.mark.asyncio
    async def test_success(self, adapter):
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"hello world", b"")
        mock_proc.returncode = 0

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter._run_cgc(["index", "/repo"], timeout=5)

        assert result == "hello world"

    @pytest.mark.asyncio
    async def test_timeout(self, adapter):
        mock_proc = AsyncMock()
        mock_proc.communicate.side_effect = asyncio.TimeoutError()
        mock_proc.kill = MagicMock()

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter._run_cgc(["index", "/repo"], timeout=1)

        assert result == ""

    @pytest.mark.asyncio
    async def test_not_found(self, adapter):
        with patch(
            "asyncio.create_subprocess_exec",
            side_effect=FileNotFoundError("cgc not found"),
        ):
            result = await adapter._run_cgc(["index", "/repo"], timeout=5)

        assert result == ""


# ── index_repository ──────────────────────────────────────────────


class TestIndexRepository:
    @pytest.mark.asyncio
    async def test_completed(self, adapter):
        with patch.object(
            adapter, "_run_cgc", return_value="Indexed 42 files successfully"
        ):
            result = await adapter.index_repository("/repo")

        assert result.status == "completed"
        assert result.job_id  # non-empty

    @pytest.mark.asyncio
    async def test_skipped(self, adapter):
        with patch.object(
            adapter, "_run_cgc", return_value="Already indexed, skipping"
        ):
            result = await adapter.index_repository("/repo")

        assert result.status == "skipped"

    @pytest.mark.asyncio
    async def test_error_no_output(self, adapter):
        with patch.object(adapter, "_run_cgc", return_value=""):
            result = await adapter.index_repository("/repo")

        assert result.status == "error"


# ── search_symbols ────────────────────────────────────────────────


class TestSearchSymbols:
    @pytest.mark.asyncio
    async def test_json_output(self, adapter):
        json_output = json.dumps([
            {"name": "foo", "type": "function", "path": "a.py", "line_number": 10, "language": "python"},
            {"name": "bar", "type": "class", "path": "b.py", "line_number": 20, "language": "python"},
        ])
        with patch.object(adapter, "_run_cgc", return_value=json_output):
            results = await adapter.search_symbols("/repo", "foo")

        assert len(results) == 2
        assert results[0].name == "foo"
        assert results[0].kind == "function"

    @pytest.mark.asyncio
    async def test_rich_table_output(self, adapter):
        table = "foo | function | a.py:10\nbar | class | b.py:20"
        with patch.object(adapter, "_run_cgc", return_value=table):
            results = await adapter.search_symbols("/repo", "foo")

        assert len(results) == 2
        assert results[0].name == "foo"
        assert results[1].file_path == "b.py"
        assert results[1].line_number == 20

    @pytest.mark.asyncio
    async def test_empty_output(self, adapter):
        with patch.object(adapter, "_run_cgc", return_value=""):
            results = await adapter.search_symbols("/repo", "foo")

        assert results == []

    @pytest.mark.asyncio
    async def test_kind_filter(self, adapter):
        with patch.object(adapter, "_run_cgc", return_value="[]") as mock:
            await adapter.search_symbols("/repo", "foo", kind="function")

        call_args = mock.call_args[0][0]
        assert "--type" in call_args
        assert "function" in call_args


# ── get_impact_analysis ───────────────────────────────────────────


class TestGetImpactAnalysis:
    @pytest.mark.asyncio
    async def test_basic(self, adapter):
        callers_json = json.dumps([{"name": "caller1", "file_path": "c.py", "line_number": 5}])
        callees_json = json.dumps([{"name": "callee1", "file_path": "d.py", "line_number": 15}])

        call_count = 0

        async def mock_run_cgc(args, timeout):
            nonlocal call_count
            call_count += 1
            if "callers" in args:
                return callers_json
            return callees_json

        with patch.object(adapter, "_run_cgc", side_effect=mock_run_cgc):
            result = await adapter.get_impact_analysis("/repo", "my_func")

        assert result.target == "my_func"
        assert len(result.callers) == 1
        assert result.callers[0]["name"] == "caller1"
        assert len(result.callees) == 1

    @pytest.mark.asyncio
    async def test_with_file_path(self, adapter):
        with patch.object(adapter, "_run_cgc", return_value="[]") as mock:
            await adapter.get_impact_analysis("/repo", "func", file_path="a.py")

        for call in mock.call_args_list:
            args = call[0][0]
            assert "--file" in args
            assert "a.py" in args
