"""Tests for ReviewLoop review prompt — truncation limits."""
from __future__ import annotations


class TestBuildReviewPrompt:
    def _make_loop(self):
        """Create ReviewLoop with a mock reviewer worker."""
        import os
        import sys

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "local-agent"))
        from local_agent.cmux.worker import ReviewLoop

        class FakeWorker:
            pass

        return ReviewLoop(FakeWorker(), workdir=".")

    def test_diff_truncated_to_2000(self):
        loop = self._make_loop()
        long_diff = "x" * 5000
        task = {"title": "test", "description": "d" * 300}
        prompt = loop._build_review_prompt(task, "", git_diff=long_diff)
        assert len(long_diff) == 5000
        assert "x" * 2001 not in prompt

    def test_output_fallback_truncated_to_1500(self):
        loop = self._make_loop()
        long_output = "y" * 5000
        task = {"title": "test", "description": "desc"}
        prompt = loop._build_review_prompt(task, long_output, git_diff="")
        assert "y" * 1501 not in prompt

    def test_description_truncated_to_200(self):
        loop = self._make_loop()
        long_desc = "z" * 500
        task = {"title": "test", "description": long_desc}
        prompt = loop._build_review_prompt(task, "output")
        assert "z" * 201 not in prompt

    def test_diff_preferred_over_output(self):
        loop = self._make_loop()
        task = {"title": "t", "description": "d"}
        prompt = loop._build_review_prompt(task, "OUTPUT_TEXT", git_diff="DIFF_TEXT")
        assert "DIFF_TEXT" in prompt
        assert "OUTPUT_TEXT" not in prompt

    def test_no_changes_uses_output(self):
        loop = self._make_loop()
        task = {"title": "t", "description": "d"}
        prompt = loop._build_review_prompt(task, "OUTPUT_TEXT", git_diff="(no changes detected)")
        assert "OUTPUT_TEXT" in prompt
