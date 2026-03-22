"""Tests for langgraph.knowledge.post_k.verify_post_knowledge."""

import pytest
from pathlib import Path

from langgraph.knowledge.post_k import verify_post_knowledge


@pytest.mark.asyncio
class TestVerifyPostKnowledge:
    """Tests for the verify_post_knowledge function."""

    async def test_clean_docs_pass(self, tmp_dir):
        """Docs with crosslinks, valid links, and no stale frontmatter should pass."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        # Create a target doc for the link
        (docs_dir / "other.md").write_text("# Other Doc\n\nSome content.")

        # Create a hub doc that references our doc
        (docs_dir / "index.md").write_text(
            "# Hub\n\n- [Clean](clean.md)\n- [Other](other.md)\n"
        )

        # Create a clean doc with a Related section and a valid link
        (docs_dir / "clean.md").write_text(
            "# Clean Doc\n\n"
            "Some content here.\n\n"
            "## Related\n\n"
            "- [Other](other.md)\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["clean.md"],
            base_path=str(docs_dir),
        )

        assert result.passed is True
        # Only check that no debts are specific to the modified doc
        doc_debts = [d for d in result.debts if d.path == "clean.md"]
        assert len(doc_debts) == 0

    async def test_missing_related_section(self, tmp_dir):
        """Docs without a '## Related' section should generate a missing_crosslink debt."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        (docs_dir / "no-related.md").write_text(
            "# No Related Section\n\nJust content, no crosslinks.\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["no-related.md"],
            base_path=str(docs_dir),
        )

        crosslink_debts = [d for d in result.debts if d.type == "missing_crosslink"]
        assert len(crosslink_debts) >= 1
        assert any("no-related.md" in d.path for d in crosslink_debts)
        assert result.summary.missing_crosslinks >= 1

    async def test_broken_links_detected(self, tmp_dir):
        """Broken relative links in docs should be detected."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        (docs_dir / "broken.md").write_text(
            "# Broken Links\n\n"
            "See [nonexistent](does-not-exist.md) for details.\n\n"
            "## Related\n\n"
            "- [Also broken](also-missing.md)\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["broken.md"],
            base_path=str(docs_dir),
        )

        broken_debts = [d for d in result.debts if d.type == "broken_link"]
        assert len(broken_debts) >= 1
        descriptions = " ".join(d.description for d in broken_debts)
        assert "does-not-exist.md" in descriptions or "also-missing.md" in descriptions
        assert result.summary.broken_links >= 1

    async def test_stale_frontmatter_detected(self, tmp_dir):
        """Docs with deprecated/stale status in frontmatter should be detected."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        (docs_dir / "stale.md").write_text(
            "---\n"
            "title: Old Guide\n"
            "status: deprecated\n"
            "---\n\n"
            "# Old Guide\n\n"
            "This is outdated content.\n\n"
            "## Related\n\n"
            "- [Nothing]()\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["stale.md"],
            base_path=str(docs_dir),
        )

        stale_debts = [d for d in result.debts if d.type == "stale_doc"]
        assert len(stale_debts) >= 1
        assert any("stale.md" in d.path for d in stale_debts)
        assert result.summary.stale_docs >= 1

    async def test_missing_hub_registration(self, tmp_dir):
        """A doc not listed in its hub file should get a missing_hub debt."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        # Hub exists but does not reference our doc
        (docs_dir / "index.md").write_text("# Hub\n\n- [Other](other.md)\n")
        (docs_dir / "other.md").write_text("# Other\n\n## Related\n\n- [Hub](index.md)\n")

        (docs_dir / "unlisted.md").write_text(
            "# Unlisted Doc\n\nNot in the hub.\n\n## Related\n\n- [Other](other.md)\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["unlisted.md"],
            base_path=str(docs_dir),
        )

        hub_debts = [d for d in result.debts if d.type == "missing_hub"]
        assert any("unlisted.md" in d.path for d in hub_debts)
        assert result.summary.missing_hub >= 1

    async def test_mission_id_propagated(self, tmp_dir):
        """The mission_id parameter should be propagated to the result."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()
        (docs_dir / "doc.md").write_text("# Doc\n\n## Related\n\n- [x]()\n")

        result = await verify_post_knowledge(
            modified_docs=["doc.md"],
            base_path=str(docs_dir),
            mission_id="mission-42",
        )

        assert result.mission_id == "mission-42"

    async def test_summary_aggregation(self, tmp_dir):
        """Summary should correctly aggregate counts from multiple debt types."""
        docs_dir = tmp_dir / "project"
        docs_dir.mkdir()

        # A doc with multiple issues: no Related section + broken link + stale
        (docs_dir / "multi-issue.md").write_text(
            "---\n"
            "status: stale\n"
            "---\n\n"
            "# Multi Issue\n\n"
            "See [broken](nonexistent.md) link.\n"
        )

        result = await verify_post_knowledge(
            modified_docs=["multi-issue.md"],
            base_path=str(docs_dir),
        )

        assert result.passed is False
        assert result.summary.total >= 2  # At least missing_crosslink + stale_doc
        assert result.summary.missing_crosslinks >= 1
        assert result.summary.stale_docs >= 1
