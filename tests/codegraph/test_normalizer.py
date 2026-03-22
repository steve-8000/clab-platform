"""Tests for codegraph normalizer functions."""
from __future__ import annotations

import pytest
from codegraph.normalizer import (
    normalize_symbol,
    normalize_relation,
    build_context_bundle,
    extract_structural_findings,
)
from codegraph.models import SymbolNode, RelationEdge


class TestNormalizeSymbol:
    def test_basic(self):
        raw = {"name": "foo", "type": "function", "path": "a.py", "line_number": 10, "language": "python"}
        result = normalize_symbol(raw)
        assert result.name == "foo"
        assert result.kind == "function"
        assert result.file_path == "a.py"
        assert result.line_number == 10
        assert result.language == "python"
        assert result.qualified_name == "a.py::foo"

    def test_alternate_keys(self):
        raw = {"function_name": "bar", "kind": "CLASS", "file_path": "b.py", "line_number": 5}
        result = normalize_symbol(raw)
        assert result.name == "bar"
        assert result.kind == "class"
        assert result.file_path == "b.py"

    def test_missing_fields(self):
        result = normalize_symbol({})
        assert result.name == ""
        assert result.kind == "unknown"
        assert result.qualified_name == ""

    def test_explicit_qualified_name(self):
        raw = {"name": "x", "type": "variable", "path": "c.py", "qualified_name": "mod.x"}
        result = normalize_symbol(raw)
        assert result.qualified_name == "mod.x"


class TestNormalizeRelation:
    def test_calls(self):
        raw = {"type": "CALLS", "source": "a", "target": "b", "file_path": "x.py", "line_number": 3}
        result = normalize_relation(raw)
        assert result is not None
        assert result.relation_type == "CALLS"
        assert result.source == "a"
        assert result.target == "b"

    def test_inherits_maps_to_extends(self):
        raw = {"type": "INHERITS", "source": "Child", "target": "Parent"}
        result = normalize_relation(raw)
        assert result is not None
        assert result.relation_type == "EXTENDS"

    def test_contains_is_skipped(self):
        raw = {"type": "CONTAINS", "source": "mod", "target": "func"}
        result = normalize_relation(raw)
        assert result is None

    def test_unknown_type_returns_none(self):
        raw = {"type": "UNKNOWN_REL", "source": "a", "target": "b"}
        result = normalize_relation(raw)
        assert result is None

    def test_alternate_keys(self):
        raw = {"relation_type": "imports", "caller": "x", "callee": "y"}
        result = normalize_relation(raw)
        assert result is not None
        assert result.relation_type == "IMPORTS"
        assert result.source == "x"
        assert result.target == "y"


class TestBuildContextBundle:
    def test_basic(self):
        symbols = [SymbolNode(name="foo", kind="function", file_path="a.py", line_number=1)]
        relations = [RelationEdge(source="foo", target="bar", relation_type="CALLS")]
        bundle = build_context_bundle(symbols, relations)
        assert bundle["symbol_count"] == 1
        assert bundle["relation_count"] == 1
        assert "function" in bundle["symbol_kinds"]
        assert "CALLS" in bundle["relation_types"]

    def test_with_task_context(self):
        bundle = build_context_bundle([], [], task_context={"task_id": "t1"})
        assert bundle["task_context"]["task_id"] == "t1"

    def test_empty(self):
        bundle = build_context_bundle([], [])
        assert bundle["symbol_count"] == 0
        assert bundle["relation_count"] == 0


class TestExtractStructuralFindings:
    def test_added_symbol(self):
        before = {"symbols": [], "relations": []}
        after = {"symbols": [{"qualified_name": "a::foo", "kind": "function", "name": "foo"}], "relations": []}
        findings = extract_structural_findings(before, after)
        types = [f["type"] for f in findings]
        assert "symbol_added" in types

    def test_removed_symbol(self):
        before = {"symbols": [{"qualified_name": "a::foo", "kind": "function", "name": "foo"}], "relations": []}
        after = {"symbols": [], "relations": []}
        findings = extract_structural_findings(before, after)
        types = [f["type"] for f in findings]
        assert "symbol_removed" in types

    def test_added_relation(self):
        before = {"symbols": [], "relations": []}
        after = {"symbols": [], "relations": [{"source": "a", "relation_type": "CALLS", "target": "b"}]}
        findings = extract_structural_findings(before, after)
        types = [f["type"] for f in findings]
        assert "relation_added" in types

    def test_count_change(self):
        before = {"symbols": [], "relations": [], "symbol_count": 5}
        after = {"symbols": [], "relations": [], "symbol_count": 10}
        findings = extract_structural_findings(before, after)
        types = [f["type"] for f in findings]
        assert "count_change" in types

    def test_no_changes(self):
        snapshot = {"symbols": [{"qualified_name": "a"}], "relations": []}
        findings = extract_structural_findings(snapshot, snapshot)
        assert len(findings) == 0
