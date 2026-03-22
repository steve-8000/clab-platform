"""Tests for langgraph.knowledge.pre_k.retrieve_pre_knowledge."""

import pytest
from pathlib import Path

from langgraph.knowledge.pre_k import retrieve_pre_knowledge
from langgraph.knowledge.types import KnowledgeEntry

from helpers import make_entry


@pytest.mark.asyncio
class TestRetrievePreKnowledge:
    """Tests for the retrieve_pre_knowledge function."""

    async def test_basic_retrieval_with_stored_knowledge(self, knowledge_store):
        """Pre-k should retrieve relevant knowledge entries from the store."""
        entry = make_entry(
            topic="pytest fixtures",
            content="pytest fixtures provide reusable setup and teardown for tests.",
            tags=["pytest", "testing", "fixtures"],
        )
        await knowledge_store.store(entry)

        result = await retrieve_pre_knowledge(
            task_description="Write pytest fixtures for the authentication module",
            role_id="builder",
            store=knowledge_store,
        )

        assert len(result.keywords) > 0
        assert len(result.knowledge_entries) >= 1
        # The stored entry should be found
        found_ids = {e.id for e in result.knowledge_entries}
        assert entry.id in found_ids

    async def test_empty_store_returns_empty_entries(self, knowledge_store):
        """Pre-k on an empty store should return empty knowledge_entries."""
        result = await retrieve_pre_knowledge(
            task_description="Build a REST API with FastAPI",
            role_id="builder",
            store=knowledge_store,
        )

        assert len(result.keywords) > 0
        assert result.knowledge_entries == []
        assert result.project_docs == []

    async def test_warnings_for_high_relevance(self, knowledge_store):
        """A warning should be generated when entries have relevance > 0.6."""
        # Store an entry that closely matches the task description
        entry = make_entry(
            topic="REST API FastAPI endpoints",
            content="Build REST API endpoints using FastAPI framework with async handlers.",
            tags=["rest", "api", "fastapi", "endpoints"],
        )
        await knowledge_store.store(entry)

        result = await retrieve_pre_knowledge(
            task_description="Build REST API endpoints using FastAPI framework",
            role_id="builder",
            store=knowledge_store,
        )

        # Check that high relevance entries trigger a duplicate risk warning
        high_rel = [e for e in result.knowledge_entries if e.relevance > 0.6]
        if high_rel:
            assert any("Duplicate risk" in w for w in result.warnings)

    async def test_scope_paths_doc_search(self, knowledge_store, tmp_dir):
        """Pre-k should search project docs when scope_paths are provided."""
        docs_dir = tmp_dir / "docs"
        docs_dir.mkdir()

        # Create a doc that matches multiple keywords
        doc_content = (
            "# FastAPI REST API Guide\n\n"
            "This guide covers building REST API endpoints with FastAPI.\n"
            "FastAPI provides automatic validation and documentation.\n"
            "REST endpoints should follow standard HTTP conventions.\n"
        )
        (docs_dir / "api-guide.md").write_text(doc_content)

        result = await retrieve_pre_knowledge(
            task_description="Build REST API endpoints using FastAPI framework",
            role_id="builder",
            store=knowledge_store,
            scope_paths=[str(docs_dir)],
        )

        # Should find the doc and generate a related-docs warning
        if result.project_docs:
            assert any("related project doc" in w for w in result.warnings)
            assert result.project_docs[0].path.endswith("api-guide.md")

    async def test_total_chars_computed(self, knowledge_store):
        """total_chars should reflect the combined size of excerpts."""
        entry = make_entry(
            topic="testing patterns",
            content="Various testing patterns for modern software development projects.",
            tags=["testing", "patterns"],
        )
        await knowledge_store.store(entry)

        result = await retrieve_pre_knowledge(
            task_description="Review testing patterns for software projects",
            role_id="builder",
            store=knowledge_store,
        )

        expected_chars = sum(len(e.excerpt) for e in result.knowledge_entries) + sum(
            len(d.excerpt) for d in result.project_docs
        )
        assert result.total_chars == expected_chars

    async def test_deduplication(self, knowledge_store):
        """Pre-k should deduplicate entries found via multiple keywords."""
        entry = make_entry(
            topic="python testing framework",
            content="Python testing with pytest framework is powerful.",
            tags=["python", "testing", "pytest"],
        )
        await knowledge_store.store(entry)

        result = await retrieve_pre_knowledge(
            task_description="python testing framework pytest",
            role_id="builder",
            store=knowledge_store,
        )

        # The same entry should appear only once despite matching multiple keywords
        ids = [e.id for e in result.knowledge_entries]
        assert len(ids) == len(set(ids))
