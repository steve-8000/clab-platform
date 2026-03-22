-- Code Intel Service — PostgreSQL schema
-- Run against the clab database to set up code-intel tables.
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- ENUMs
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE graph_build_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE symbol_kind AS ENUM ('function', 'class', 'module', 'variable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE relation_type AS ENUM (
        'IMPORTS', 'CALLS', 'IMPLEMENTS', 'EXTENDS', 'USES_TYPE',
        'DECLARES_ROUTE', 'PUBLISHES_EVENT', 'CONSUMES_EVENT',
        'OWNS_TEST', 'REFERENCES_SCHEMA'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE finding_type AS ENUM (
        'NEW_CYCLE', 'BLAST_RADIUS_INCREASED', 'DEAD_CODE_CANDIDATE',
        'MISSING_TEST_RELATION', 'COMPLEXITY_SPIKE', 'PUBLIC_CONTRACT_CHANGED',
        'UNSCOPED_CHANGE', 'EVENT_FLOW_RISK'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE finding_severity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ci_repositories (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    url         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ci_repo_snapshots (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    repository_id   TEXT NOT NULL REFERENCES ci_repositories(id) ON DELETE CASCADE,
    commit_hash     TEXT NOT NULL,
    branch          TEXT NOT NULL,
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB DEFAULT '{}'::jsonb,
    UNIQUE(repository_id, commit_hash)
);

CREATE TABLE IF NOT EXISTS ci_graph_builds (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id     TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    status          graph_build_status NOT NULL DEFAULT 'PENDING',
    engine_type     TEXT NOT NULL DEFAULT 'cgc_cli',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,
    node_count      INTEGER,
    edge_count      INTEGER,
    error_message   TEXT
);

CREATE TABLE IF NOT EXISTS ci_symbol_nodes (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id     TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    fq_name         TEXT NOT NULL,
    name            TEXT NOT NULL,
    kind            symbol_kind NOT NULL,
    file_path       TEXT NOT NULL,
    line_number     INTEGER NOT NULL,
    language        TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ci_relation_edges (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id     TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    from_symbol_id  TEXT NOT NULL REFERENCES ci_symbol_nodes(id) ON DELETE CASCADE,
    to_symbol_id    TEXT NOT NULL REFERENCES ci_symbol_nodes(id) ON DELETE CASCADE,
    relation_type   relation_type NOT NULL,
    metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ci_impact_analyses (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id         TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    target_symbol_id    TEXT NOT NULL REFERENCES ci_symbol_nodes(id) ON DELETE CASCADE,
    direct_impact       JSONB NOT NULL DEFAULT '[]'::jsonb,
    transitive_impact   JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_tests       JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_score          DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ci_context_bundles (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id         TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    task_run_id         TEXT NOT NULL,
    primary_targets     JSONB NOT NULL DEFAULT '[]'::jsonb,
    direct_relations    JSONB NOT NULL DEFAULT '[]'::jsonb,
    transitive_impact   JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_files       JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_tests       JSONB NOT NULL DEFAULT '[]'::jsonb,
    hotspots            JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings            JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary             TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ci_structural_findings (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id         TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    review_id           TEXT NOT NULL,
    finding_type        finding_type NOT NULL,
    severity            finding_severity NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    affected_symbols    JSONB NOT NULL DEFAULT '[]'::jsonb,
    affected_files      JSONB NOT NULL DEFAULT '[]'::jsonb,
    metrics_delta       JSONB,
    recommendation      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ci_scope_drift_events (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    snapshot_id     TEXT NOT NULL REFERENCES ci_repo_snapshots(id) ON DELETE CASCADE,
    task_run_id     TEXT NOT NULL,
    planned_scope   JSONB NOT NULL DEFAULT '[]'::jsonb,
    actual_scope    JSONB NOT NULL DEFAULT '[]'::jsonb,
    drift_ratio     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Snapshot-based queries (most queries scope to a snapshot)
CREATE INDEX IF NOT EXISTS idx_ci_snapshots_repo ON ci_repo_snapshots(repository_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_builds_snapshot ON ci_graph_builds(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_symbol_nodes_snapshot ON ci_symbol_nodes(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_relation_edges_snapshot ON ci_relation_edges(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_impact_analyses_snapshot ON ci_impact_analyses(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_context_bundles_snapshot ON ci_context_bundles(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_structural_findings_snapshot ON ci_structural_findings(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ci_scope_drift_snapshot ON ci_scope_drift_events(snapshot_id);

-- fq_name search (btree + trigram for LIKE/ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_ci_symbol_nodes_fq_name ON ci_symbol_nodes(fq_name);
CREATE INDEX IF NOT EXISTS idx_ci_symbol_nodes_fq_name_trgm ON ci_symbol_nodes USING gin (fq_name gin_trgm_ops);

-- File path search
CREATE INDEX IF NOT EXISTS idx_ci_symbol_nodes_file_path ON ci_symbol_nodes(file_path);

-- Relation traversal (from/to)
CREATE INDEX IF NOT EXISTS idx_ci_relation_edges_from ON ci_relation_edges(from_symbol_id);
CREATE INDEX IF NOT EXISTS idx_ci_relation_edges_to ON ci_relation_edges(to_symbol_id);

-- Context bundle by task_run_id
CREATE INDEX IF NOT EXISTS idx_ci_context_bundles_task ON ci_context_bundles(task_run_id);

-- Structural findings by review_id
CREATE INDEX IF NOT EXISTS idx_ci_structural_findings_review ON ci_structural_findings(review_id);

-- Scope drift by task_run_id
CREATE INDEX IF NOT EXISTS idx_ci_scope_drift_task ON ci_scope_drift_events(task_run_id);

-- Graph build status for filtering
CREATE INDEX IF NOT EXISTS idx_ci_graph_builds_status ON ci_graph_builds(status);

-- Impact analysis target lookup
CREATE INDEX IF NOT EXISTS idx_ci_impact_target ON ci_impact_analyses(target_symbol_id);
