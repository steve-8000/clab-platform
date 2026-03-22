"""Tests for planner node — context truncation and codex engine enforcement."""
from __future__ import annotations

import json

from graph.planner import PLANNER_SYSTEM_PROMPT, _parse_tasks


class TestParseTasks:
    def test_engine_always_codex(self):
        """All parsed tasks must have engine='codex' regardless of LLM output."""
        raw = json.dumps([
            {"id": "1", "title": "t1", "description": "d1", "engine": "claude"},
            {"id": "2", "title": "t2", "description": "d2", "engine": "codex"},
            {"id": "3", "title": "t3", "description": "d3"},
        ])
        tasks = _parse_tasks(raw)
        assert len(tasks) == 3
        for t in tasks:
            assert t["engine"] == "codex", f"Task {t['id']} has engine={t['engine']}"

    def test_fallback_single_task(self):
        """Non-JSON response becomes single codex task."""
        tasks = _parse_tasks("just do the thing")
        assert len(tasks) == 1
        assert tasks[0]["engine"] == "codex"
        assert tasks[0]["description"] == "just do the thing"

    def test_status_and_attempt_defaults(self):
        raw = json.dumps([{"id": "1", "title": "t", "description": "d"}])
        tasks = _parse_tasks(raw)
        assert tasks[0]["status"] == "pending"
        assert tasks[0]["attempt"] == 0

    def test_json_in_surrounding_text(self):
        """Parser extracts JSON array from mixed text."""
        content = 'Here is the plan:\n[{"id":"1","title":"t","description":"d"}]\nDone.'
        tasks = _parse_tasks(content)
        assert len(tasks) == 1
        assert tasks[0]["title"] == "t"


class TestPlannerSystemPrompt:
    def test_codex_only_directive(self):
        assert "codex" in PLANNER_SYSTEM_PROMPT.lower()
        assert "never use" in PLANNER_SYSTEM_PROMPT.lower() and "claude" in PLANNER_SYSTEM_PROMPT.lower()
