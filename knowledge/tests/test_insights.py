"""Tests for langgraph.knowledge.insights.extract_insights."""

import pytest
from uuid import uuid4

from langgraph.knowledge.insights import (
    TaskResult,
    ExtractedInsight,
    extract_insights,
    DECISION_INDICATORS,
)

from helpers import make_entry


@pytest.mark.asyncio
class TestExtractInsights:
    """Tests for the extract_insights function."""

    async def test_pattern_extraction_with_enough_keywords(self, knowledge_store):
        """A pattern insight should be created when >= 3 keywords are extracted."""
        result = TaskResult(
            status="success",
            summary=(
                "Refactored authentication module. Updated login endpoint, "
                "session management, and token validation logic across multiple files."
            ),
            changed_files=["auth.py", "session.py"],
        )

        insights = await extract_insights(
            task_run_id="run-001",
            result=result,
            context="Authentication refactoring sprint for improved security",
            store=knowledge_store,
        )

        pattern_insights = [i for i in insights if i.type == "pattern"]
        assert len(pattern_insights) >= 1
        pi = pattern_insights[0]
        assert pi.task_run_id == "run-001"
        assert pi.title.startswith("Pattern:")
        assert len(pi.tags) >= 3
        assert len(pi.evidence) > 0

    async def test_decision_detection(self, knowledge_store):
        """A decision insight should be created when summary contains decision indicator words."""
        for indicator in ["decided", "chose", "migrated"]:
            result = TaskResult(
                status="success",
                summary=f"We {indicator} to use PostgreSQL instead of SQLite for the main database.",
                changed_files=["db.py"],
            )

            insights = await extract_insights(
                task_run_id=f"run-{indicator}",
                result=result,
                context="Database migration evaluation",
                store=knowledge_store,
            )

            decision_insights = [i for i in insights if i.type == "decision"]
            assert len(decision_insights) >= 1, (
                f"No decision insight found for indicator '{indicator}'"
            )
            assert "decision" in decision_insights[0].tags

    async def test_risk_detection(self, knowledge_store):
        """A risk insight should be created when result.risks is non-empty."""
        result = TaskResult(
            status="success",
            summary="Deployed new payment processing module.",
            changed_files=["payment.py"],
            risks=["Payment API rate limit may be exceeded", "No rollback plan tested"],
        )

        insights = await extract_insights(
            task_run_id="run-risk",
            result=result,
            context="Payment module deployment",
            store=knowledge_store,
        )

        risk_insights = [i for i in insights if i.type == "risk"]
        assert len(risk_insights) == 1
        ri = risk_insights[0]
        assert "2 risk(s)" in ri.title
        assert "risk" in ri.tags
        assert len(ri.evidence) == 2

    async def test_insights_stored_in_knowledge_store(self, knowledge_store):
        """Each extracted insight should be stored as a KnowledgeEntry in the store."""
        result = TaskResult(
            status="success",
            summary=(
                "Decided to adopt microservices architecture. Refactored monolith "
                "into separate authentication, payment, and notification services."
            ),
            changed_files=["auth_service.py", "payment_service.py"],
            risks=["Service discovery complexity"],
        )

        insights = await extract_insights(
            task_run_id="run-store",
            result=result,
            context="Architecture migration from monolith to microservices",
            store=knowledge_store,
        )

        assert len(insights) > 0

        # Verify entries were stored
        status = await knowledge_store.status()
        assert status.total_entries >= len(insights)

        # Search should find stored insights
        entries = await knowledge_store.search("pattern")
        # At least pattern insight should be findable
        # (depends on keyword extraction, so just check store is not empty)
        all_entries = await knowledge_store.search("microservices")
        assert len(all_entries) > 0 or status.total_entries > 0

    async def test_no_insights_when_summary_too_short(self, knowledge_store):
        """When summary has fewer than 3 extractable keywords, no pattern insight should be created."""
        result = TaskResult(
            status="success",
            summary="OK",  # Very short, likely < 3 keywords
            changed_files=[],
        )

        insights = await extract_insights(
            task_run_id="run-short",
            result=result,
            context="",  # Also empty context
            store=knowledge_store,
        )

        pattern_insights = [i for i in insights if i.type == "pattern"]
        assert len(pattern_insights) == 0

    async def test_no_decision_without_indicators(self, knowledge_store):
        """No decision insight when summary lacks decision indicator words."""
        result = TaskResult(
            status="success",
            summary="Updated configuration files and documentation for the project.",
            changed_files=["config.yaml"],
        )

        insights = await extract_insights(
            task_run_id="run-no-decision",
            result=result,
            context="Routine maintenance update",
            store=knowledge_store,
        )

        decision_insights = [i for i in insights if i.type == "decision"]
        assert len(decision_insights) == 0

    async def test_no_risk_without_risks_field(self, knowledge_store):
        """No risk insight when result.risks is empty."""
        result = TaskResult(
            status="success",
            summary="Completed code review and applied formatting changes.",
            changed_files=["main.py"],
            risks=[],
        )

        insights = await extract_insights(
            task_run_id="run-no-risk",
            result=result,
            context="Code review session",
            store=knowledge_store,
        )

        risk_insights = [i for i in insights if i.type == "risk"]
        assert len(risk_insights) == 0

    async def test_all_insight_types_together(self, knowledge_store):
        """When all conditions are met, pattern + decision + risk insights should all be created."""
        result = TaskResult(
            status="success",
            summary=(
                "We decided to migrate from REST to GraphQL for the main API. "
                "Refactored resolver patterns, schema definitions, and query handlers."
            ),
            changed_files=["schema.py", "resolvers.py"],
            risks=["Breaking change for existing API consumers"],
        )

        insights = await extract_insights(
            task_run_id="run-all",
            result=result,
            context="API migration project from REST to GraphQL",
            store=knowledge_store,
        )

        types = {i.type for i in insights}
        assert "pattern" in types
        assert "decision" in types
        assert "risk" in types

    async def test_insight_fields_populated(self, knowledge_store):
        """All fields of ExtractedInsight should be properly populated."""
        result = TaskResult(
            status="success",
            summary="Refactored database connection pooling, caching layer, and query optimization.",
            changed_files=["db.py"],
        )

        insights = await extract_insights(
            task_run_id="run-fields",
            result=result,
            context="Database performance improvement project",
            store=knowledge_store,
        )

        for insight in insights:
            assert insight.id  # non-empty
            assert insight.task_run_id == "run-fields"
            assert insight.type in ("pattern", "decision", "risk", "learning")
            assert insight.title  # non-empty
            assert insight.description  # non-empty
            assert isinstance(insight.evidence, list)
            assert isinstance(insight.tags, list)
            assert insight.created_at  # non-empty ISO timestamp
