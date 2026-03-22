"""Pydantic models for CodeGraph adapter outputs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class IndexResult(BaseModel):
    """Result of a repository indexing operation."""

    job_id: str = ""
    status: str = "unknown"
    message: str = ""


class RepoSummary(BaseModel):
    """High-level statistics for an indexed repository."""

    repo_path: str = ""
    file_count: int = 0
    function_count: int = 0
    class_count: int = 0
    module_count: int = 0
    languages: list[str] = Field(default_factory=list)


class SymbolResult(BaseModel):
    """A single symbol found by search."""

    name: str = ""
    kind: str = ""
    file_path: str = ""
    line_number: int = 0
    language: str = ""


class ImpactResult(BaseModel):
    """Impact analysis for a given target symbol."""

    target: str = ""
    callers: list[dict] = Field(default_factory=list)
    callees: list[dict] = Field(default_factory=list)
    dependents: list[dict] = Field(default_factory=list)
    importers: list[dict] = Field(default_factory=list)


class CallRelations(BaseModel):
    """Caller/callee relations for a function."""

    target: str = ""
    callers: list[dict] = Field(default_factory=list)
    callees: list[dict] = Field(default_factory=list)


class ComplexitySignal(BaseModel):
    """Cyclomatic complexity signal for a function."""

    name: str = ""
    file_path: str = ""
    complexity_score: float = 0.0
    line_count: int = 0


class DeadCodeCandidate(BaseModel):
    """A potentially unused code element."""

    name: str = ""
    file_path: str = ""
    line_number: int = 0
    kind: str = ""


# --- Domain models for normalizer ---


class SymbolNode(BaseModel):
    """Normalized symbol node in the clab domain."""

    name: str = ""
    kind: str = ""
    file_path: str = ""
    line_number: int = 0
    language: str = ""
    qualified_name: str = ""


class RelationEdge(BaseModel):
    """Normalized relation edge in the clab domain."""

    source: str = ""
    target: str = ""
    relation_type: str = ""
    file_path: str = ""
    line_number: int = 0
