"""Pydantic models for the Code Intel domain."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Domain models (DB row representations)
# ---------------------------------------------------------------------------

class Repository(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    url: str
    name: str
    default_branch: str = "main"
    status: str = "active"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RepoSnapshot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    repository_id: str
    commit_hash: str
    branch: str
    snapshot_at: datetime | None = None
    metadata: dict | None = None


class GraphBuild(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED"] = "PENDING"
    engine_type: str = "cgc_cli"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    node_count: int | None = None
    edge_count: int | None = None
    error_message: str | None = None


class SymbolNode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    fq_name: str
    name: str
    kind: Literal["function", "class", "module", "variable"]
    file_path: str
    line_number: int
    language: str
    metadata: dict | None = None


class RelationEdge(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    from_symbol_id: str
    to_symbol_id: str
    relation_type: Literal[
        "IMPORTS",
        "CALLS",
        "IMPLEMENTS",
        "EXTENDS",
        "USES_TYPE",
        "DECLARES_ROUTE",
        "PUBLISHES_EVENT",
        "CONSUMES_EVENT",
        "OWNS_TEST",
        "REFERENCES_SCHEMA",
    ]
    metadata: dict | None = None


class ImpactAnalysis(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    target_symbol_id: str
    direct_impact: list = Field(default_factory=list)
    transitive_impact: list = Field(default_factory=list)
    related_tests: list = Field(default_factory=list)
    risk_score: float = 0.0
    created_at: datetime | None = None


class ContextBundle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    task_run_id: str
    primary_targets: list = Field(default_factory=list)
    direct_relations: list = Field(default_factory=list)
    transitive_impact: list = Field(default_factory=list)
    related_files: list = Field(default_factory=list)
    related_tests: list = Field(default_factory=list)
    hotspots: list = Field(default_factory=list)
    warnings: list = Field(default_factory=list)
    summary: str = ""
    created_at: datetime | None = None


class StructuralFinding(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    review_id: str
    finding_type: Literal[
        "NEW_CYCLE",
        "BLAST_RADIUS_INCREASED",
        "DEAD_CODE_CANDIDATE",
        "MISSING_TEST_RELATION",
        "COMPLEXITY_SPIKE",
        "PUBLIC_CONTRACT_CHANGED",
        "UNSCOPED_CHANGE",
        "EVENT_FLOW_RISK",
    ]
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    title: str
    description: str
    affected_symbols: list = Field(default_factory=list)
    affected_files: list = Field(default_factory=list)
    metrics_delta: dict | None = None
    recommendation: str | None = None
    created_at: datetime | None = None


class ScopeDriftEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    snapshot_id: str
    task_run_id: str
    planned_scope: list = Field(default_factory=list)
    actual_scope: list = Field(default_factory=list)
    drift_ratio: float = 0.0
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CreateRepositoryRequest(BaseModel):
    url: str
    name: str
    default_branch: str = "main"


class TriggerIndexRequest(BaseModel):
    branch: str | None = None
    commit_hash: str | None = None
    languages: list[str] | None = None


class SymbolSearchParams(BaseModel):
    q: str
    type: str | None = None
    limit: int = 50


class ImpactRequest(BaseModel):
    target: str | None = None
    file: str | None = None


class HotspotParams(BaseModel):
    metric: str = "complexity"
    limit: int = 20


class RepositoryResponse(BaseModel):
    repository: Repository


class RepositoryListResponse(BaseModel):
    repositories: list[Repository]


class SnapshotListResponse(BaseModel):
    snapshots: list[RepoSnapshot]


class IndexTriggerResponse(BaseModel):
    snapshot: RepoSnapshot
    graph_build: GraphBuild
    message: str = "Indexing started"


class SymbolSearchResponse(BaseModel):
    symbols: list[SymbolNode]
    total: int


class ImpactResponse(BaseModel):
    target: str
    direct: list[str]
    transitive: list[str]
    related_tests: list[str]
    risk_score: float


class HotspotResponse(BaseModel):
    hotspots: list[dict]


class RepoSummaryResponse(BaseModel):
    total_files: int
    total_symbols: int
    total_relations: int
    languages: dict[str, int]
    top_complexity: list[dict]


class ContextBundleResponse(BaseModel):
    context_bundle: ContextBundle


class StructuralFindingsResponse(BaseModel):
    findings: list[StructuralFinding]


class HealthResponse(BaseModel):
    status: str
    service: str
    db: str
    cgc: str
