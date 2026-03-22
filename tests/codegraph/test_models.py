"""Tests for codegraph models."""
from codegraph.models import (
    IndexResult,
    RepoSummary,
    SymbolResult,
    ImpactResult,
    CallRelations,
    ComplexitySignal,
    DeadCodeCandidate,
    SymbolNode,
    RelationEdge,
)


class TestIndexResult:
    def test_defaults(self):
        r = IndexResult()
        assert r.status == "unknown"
        assert r.message == ""

    def test_values(self):
        r = IndexResult(job_id="j1", status="completed", message="ok")
        assert r.job_id == "j1"
        assert r.status == "completed"


class TestRepoSummary:
    def test_defaults(self):
        s = RepoSummary()
        assert s.file_count == 0
        assert s.languages == []

    def test_values(self):
        s = RepoSummary(repo_path="/repo", file_count=42, languages=["python"])
        assert s.file_count == 42
        assert "python" in s.languages


class TestSymbolResult:
    def test_defaults(self):
        s = SymbolResult()
        assert s.name == ""
        assert s.line_number == 0


class TestImpactResult:
    def test_defaults(self):
        r = ImpactResult()
        assert r.callers == []
        assert r.callees == []


class TestSymbolNode:
    def test_creation(self):
        n = SymbolNode(name="foo", kind="function", file_path="a.py", line_number=1, qualified_name="a::foo")
        assert n.name == "foo"


class TestRelationEdge:
    def test_creation(self):
        e = RelationEdge(source="a", target="b", relation_type="CALLS")
        assert e.relation_type == "CALLS"
