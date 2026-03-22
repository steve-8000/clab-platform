"""Tests for langgraph.knowledge.local_store.LocalKnowledgeStore."""

import pytest
from uuid import uuid4
from datetime import datetime, timezone

from langgraph.knowledge.types import KnowledgeEntry
from langgraph.knowledge.local_store import LocalKnowledgeStore

from helpers import make_entry


@pytest.mark.asyncio
class TestLocalKnowledgeStore:
    """Tests for the LocalKnowledgeStore class."""

    async def test_store_and_retrieve(self, knowledge_store, sample_entry):
        """Store an entry and retrieve it by search."""
        await knowledge_store.store(sample_entry)
        results = await knowledge_store.search("pytest")
        assert len(results) >= 1
        found = results[0]
        assert found.id == sample_entry.id
        assert found.topic == sample_entry.topic
        assert found.content == sample_entry.content

    async def test_search_topic_scores_higher(self, knowledge_store):
        """An entry matching the query in topic should score higher than content-only match."""
        entry_topic = make_entry(
            topic="pytest framework",
            content="A generic tool for code quality.",
            tags=["tool"],
        )
        entry_content = make_entry(
            topic="Code quality",
            content="Use pytest for testing your code effectively.",
            tags=["quality"],
        )
        await knowledge_store.store(entry_topic)
        await knowledge_store.store(entry_content)

        results = await knowledge_store.search("pytest")
        assert len(results) == 2
        # topic match (score 3+) should appear before content-only match (score 2)
        assert results[0].id == entry_topic.id

    async def test_search_empty_for_no_match(self, knowledge_store, sample_entry):
        """Search with unrelated query returns empty list."""
        await knowledge_store.store(sample_entry)
        results = await knowledge_store.search("kubernetes deployment helm")
        assert results == []

    async def test_search_empty_query(self, knowledge_store, sample_entry):
        """Search with empty query returns empty list."""
        await knowledge_store.store(sample_entry)
        results = await knowledge_store.search("")
        assert results == []

    async def test_get_by_topic_case_insensitive(self, knowledge_store):
        """get_by_topic should match case-insensitively."""
        entry = make_entry(topic="Python Testing")
        await knowledge_store.store(entry)

        results = await knowledge_store.get_by_topic("python testing")
        assert len(results) == 1
        assert results[0].id == entry.id

        results = await knowledge_store.get_by_topic("PYTHON TESTING")
        assert len(results) == 1
        assert results[0].id == entry.id

    async def test_get_by_tags_any_match(self, knowledge_store):
        """get_by_tags should return entries matching ANY of the given tags."""
        entry1 = make_entry(topic="Entry 1", tags=["python", "testing"])
        entry2 = make_entry(topic="Entry 2", tags=["java", "testing"])
        entry3 = make_entry(topic="Entry 3", tags=["rust", "systems"])
        await knowledge_store.store(entry1)
        await knowledge_store.store(entry2)
        await knowledge_store.store(entry3)

        results = await knowledge_store.get_by_tags(["python"])
        assert len(results) == 1
        assert results[0].id == entry1.id

        results = await knowledge_store.get_by_tags(["testing"])
        assert len(results) == 2
        ids = {r.id for r in results}
        assert entry1.id in ids
        assert entry2.id in ids

    async def test_get_by_tags_case_insensitive(self, knowledge_store):
        """Tag matching should be case-insensitive."""
        entry = make_entry(topic="Entry", tags=["Python"])
        await knowledge_store.store(entry)

        results = await knowledge_store.get_by_tags(["python"])
        assert len(results) == 1

        results = await knowledge_store.get_by_tags(["PYTHON"])
        assert len(results) == 1

    async def test_status_empty_store(self, knowledge_store):
        """Status on empty store returns zeroed StoreStatus."""
        st = await knowledge_store.status()
        assert st.total_entries == 0
        assert st.unique_topics == 0
        assert st.last_updated is None

    async def test_status_with_entries(self, knowledge_store):
        """Status returns correct counts after storing entries."""
        e1 = make_entry(topic="Topic A", created_at="2025-01-01T00:00:00+00:00")
        e2 = make_entry(topic="Topic B", created_at="2025-06-15T00:00:00+00:00")
        e3 = make_entry(topic="Topic A", created_at="2025-03-01T00:00:00+00:00")
        await knowledge_store.store(e1)
        await knowledge_store.store(e2)
        await knowledge_store.store(e3)

        st = await knowledge_store.status()
        assert st.total_entries == 3
        assert st.unique_topics == 2  # Topic A and Topic B
        assert st.last_updated == "2025-06-15T00:00:00+00:00"

    async def test_delete_entry(self, knowledge_store, sample_entry):
        """Delete should remove the entry from the store."""
        await knowledge_store.store(sample_entry)
        results = await knowledge_store.search("pytest")
        assert len(results) >= 1

        await knowledge_store.delete(sample_entry.id)
        results = await knowledge_store.search("pytest")
        assert len(results) == 0

    async def test_delete_nonexistent_raises_key_error(self, knowledge_store):
        """Deleting a non-existent entry should raise KeyError."""
        with pytest.raises(KeyError):
            await knowledge_store.delete("nonexistent-id-12345")

    async def test_search_respects_limit(self, knowledge_store):
        """Search should respect the limit parameter."""
        for i in range(10):
            entry = make_entry(
                topic=f"Python topic {i}",
                content=f"Python content {i}",
                tags=["python"],
            )
            await knowledge_store.store(entry)

        results = await knowledge_store.search("python", limit=3)
        assert len(results) == 3

    async def test_store_overwrites_existing(self, knowledge_store):
        """Storing an entry with the same ID should overwrite the previous one."""
        entry_id = str(uuid4())
        entry_v1 = make_entry(id=entry_id, topic="Version 1", content="First version")
        entry_v2 = make_entry(id=entry_id, topic="Version 2", content="Second version")

        await knowledge_store.store(entry_v1)
        await knowledge_store.store(entry_v2)

        results = await knowledge_store.get_by_topic("Version 2")
        assert len(results) == 1
        assert results[0].content == "Second version"

        results = await knowledge_store.get_by_topic("Version 1")
        assert len(results) == 0

    async def test_search_tag_match(self, knowledge_store):
        """Search should also match against tags."""
        entry = make_entry(
            topic="Database setup",
            content="Configure connection pooling.",
            tags=["postgresql", "database"],
        )
        await knowledge_store.store(entry)

        results = await knowledge_store.search("postgresql")
        assert len(results) == 1
        assert results[0].id == entry.id

    async def test_directory_created_automatically(self, tmp_dir):
        """LocalKnowledgeStore should create the directory if it does not exist."""
        deep_path = tmp_dir / "a" / "b" / "c" / "knowledge"
        store = LocalKnowledgeStore(str(deep_path))
        assert deep_path.exists()
        st = await store.status()
        assert st.total_entries == 0
