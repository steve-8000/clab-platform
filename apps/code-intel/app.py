"""Code Intel Service — code graph analysis and structural intelligence API."""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import (
    CGC_BINARY_PATH,
    CGC_TIMEOUT_INDEX,
    CGC_TIMEOUT_QUERY,
    CLAB_CONTROL_URL,
    CODE_INTEL_DB_URL,
)
from .models import (
    ContextBundleResponse,
    CreateRepositoryRequest,
    HealthResponse,
    HotspotResponse,
    ImpactResponse,
    IndexTriggerResponse,
    RepoSummaryResponse,
    RepositoryListResponse,
    RepositoryResponse,
    SnapshotListResponse,
    StructuralFindingsResponse,
    SymbolSearchResponse,
    TriggerIndexRequest,
)

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
pool: asyncpg.Pool | None = None
cgc_engine: Any = None  # CgcCliEngineAdapter instance (lazy)


def _get_cgc_engine():
    """Lazily instantiate CgcCliEngineAdapter."""
    global cgc_engine
    if cgc_engine is None:
        try:
            from codegraph import CgcCliEngineAdapter

            cgc_engine = CgcCliEngineAdapter(
                cgc_binary_path=CGC_BINARY_PATH,
                timeout_index=CGC_TIMEOUT_INDEX,
                timeout_query=CGC_TIMEOUT_QUERY,
            )
        except ImportError:
            logger.warning("codegraph package not available; CGC features disabled")
    return cgc_engine


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    try:
        pool = await asyncpg.create_pool(CODE_INTEL_DB_URL, min_size=2, max_size=10)
        logger.info("DB pool created", dsn=CODE_INTEL_DB_URL)
    except Exception as exc:
        logger.error("Failed to create DB pool", error=str(exc))
        pool = None
    yield
    if pool:
        await pool.close()
        logger.info("DB pool closed")


app = FastAPI(title="Code Intel Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# DB Helpers
# ---------------------------------------------------------------------------

def _ensure_pool() -> asyncpg.Pool:
    if pool is None:
        raise HTTPException(503, "Database connection not available")
    return pool


def _row_to_dict(row: asyncpg.Record | None) -> dict | None:
    if row is None:
        return None
    out = dict(row)
    for key, val in out.items():
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    return out


def _rows_to_list(rows: list[asyncpg.Record]) -> list[dict]:
    return [_row_to_dict(r) for r in rows if r is not None]


def _parse_jsonb(val: Any) -> Any:
    """Parse a JSONB value that asyncpg may return as str or already-decoded."""
    if val is None:
        return None
    if isinstance(val, str):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return val
    return val


# ---------------------------------------------------------------------------
# Repository Management
# ---------------------------------------------------------------------------

@app.post("/repositories", response_model=RepositoryResponse)
async def create_repository(req: CreateRepositoryRequest):
    db = _ensure_pool()
    repo_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    try:
        row = await db.fetchrow(
            """
            INSERT INTO ci_repositories (id, url, name, default_branch, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'active', $5, $5)
            RETURNING *
            """,
            repo_id, req.url, req.name, req.default_branch, now,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, f"Repository with url '{req.url}' already exists")
    return {"repository": _row_to_dict(row)}


@app.get("/repositories", response_model=RepositoryListResponse)
async def list_repositories(status: str | None = None):
    db = _ensure_pool()
    if status:
        rows = await db.fetch(
            "SELECT * FROM ci_repositories WHERE status = $1 ORDER BY created_at DESC",
            status,
        )
    else:
        rows = await db.fetch("SELECT * FROM ci_repositories ORDER BY created_at DESC")
    return {"repositories": _rows_to_list(rows)}


@app.get("/repositories/{repo_id}", response_model=RepositoryResponse)
async def get_repository(repo_id: str):
    db = _ensure_pool()
    row = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not row:
        raise HTTPException(404, "Repository not found")
    return {"repository": _row_to_dict(row)}


@app.post("/repositories/{repo_id}/index", response_model=IndexTriggerResponse)
async def trigger_index(repo_id: str, req: TriggerIndexRequest, background_tasks: BackgroundTasks):
    db = _ensure_pool()
    repo = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not repo:
        raise HTTPException(404, "Repository not found")

    branch = req.branch or repo["default_branch"]
    commit_hash = req.commit_hash or "HEAD"
    snapshot_id = str(uuid.uuid4())
    build_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    snapshot_row = await db.fetchrow(
        """
        INSERT INTO ci_repo_snapshots (id, repository_id, commit_hash, branch, snapshot_at, metadata)
        VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
        RETURNING *
        """,
        snapshot_id, repo_id, commit_hash, branch, now,
    )

    build_row = await db.fetchrow(
        """
        INSERT INTO ci_graph_builds (id, snapshot_id, status, engine_type)
        VALUES ($1, $2, 'PENDING', 'cgc_cli')
        RETURNING *
        """,
        build_id, snapshot_id,
    )

    background_tasks.add_task(_run_indexing, build_id, snapshot_id, repo["url"], branch, req.languages)

    return {
        "snapshot": _row_to_dict(snapshot_row),
        "graph_build": _row_to_dict(build_row),
        "message": "Indexing started",
    }


async def _run_indexing(
    build_id: str,
    snapshot_id: str,
    repo_url: str,
    branch: str,
    languages: list[str] | None,
):
    """Background task: run CGC indexing and persist results."""
    db = _ensure_pool()
    engine = _get_cgc_engine()
    now = datetime.now(timezone.utc)

    await db.execute(
        "UPDATE ci_graph_builds SET status = 'RUNNING', started_at = $2 WHERE id = $1",
        build_id, now,
    )

    if engine is None:
        await db.execute(
            """
            UPDATE ci_graph_builds
            SET status = 'FAILED', completed_at = $2, error_message = 'CGC engine not available'
            WHERE id = $1
            """,
            build_id, datetime.now(timezone.utc),
        )
        return

    try:
        result = await engine.index_repository(repo_url)
        completed = datetime.now(timezone.utc)
        duration_ms = int((completed - now).total_seconds() * 1000)

        await db.execute(
            """
            UPDATE ci_graph_builds
            SET status = 'COMPLETED', completed_at = $2, duration_ms = $3,
                node_count = $4, edge_count = $5
            WHERE id = $1
            """,
            build_id, completed, duration_ms, 0, 0,
        )
        logger.info(
            "Indexing completed",
            build_id=build_id,
            status=result.status,
            message=result.message,
        )
    except Exception as exc:
        await db.execute(
            """
            UPDATE ci_graph_builds
            SET status = 'FAILED', completed_at = $2, error_message = $3
            WHERE id = $1
            """,
            build_id, datetime.now(timezone.utc), str(exc)[:2000],
        )
        logger.error("Indexing failed", build_id=build_id, error=str(exc))


@app.get("/repositories/{repo_id}/snapshots", response_model=SnapshotListResponse)
async def list_snapshots(repo_id: str):
    db = _ensure_pool()
    rows = await db.fetch(
        "SELECT * FROM ci_repo_snapshots WHERE repository_id = $1 ORDER BY snapshot_at DESC",
        repo_id,
    )
    return {"snapshots": _rows_to_list(rows)}


@app.get("/repositories/{repo_id}/summary", response_model=RepoSummaryResponse)
async def get_repo_summary(repo_id: str):
    db = _ensure_pool()
    repo = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not repo:
        raise HTTPException(404, "Repository not found")

    # Try CGC engine first for live data
    engine = _get_cgc_engine()
    if engine:
        try:
            stats = await engine.get_repository_summary(repo["url"])
            return {
                "total_files": stats.file_count,
                "total_symbols": stats.function_count,
                "total_relations": 0,
                "languages": stats.languages,
                "top_complexity": [],
            }
        except Exception as exc:
            logger.warning("CGC summary failed, falling back to DB", error=str(exc))

    # Fallback: compute from latest snapshot in DB
    latest = await db.fetchrow(
        """
        SELECT s.id FROM ci_repo_snapshots s
        JOIN ci_graph_builds g ON g.snapshot_id = s.id AND g.status = 'COMPLETED'
        WHERE s.repository_id = $1
        ORDER BY s.snapshot_at DESC LIMIT 1
        """,
        repo_id,
    )
    if not latest:
        return {
            "total_files": 0,
            "total_symbols": 0,
            "total_relations": 0,
            "languages": {},
            "top_complexity": [],
        }

    sid = latest["id"]
    sym_count = await db.fetchval("SELECT COUNT(*) FROM ci_symbol_nodes WHERE snapshot_id = $1", sid)
    rel_count = await db.fetchval("SELECT COUNT(*) FROM ci_relation_edges WHERE snapshot_id = $1", sid)
    file_count = await db.fetchval(
        "SELECT COUNT(DISTINCT file_path) FROM ci_symbol_nodes WHERE snapshot_id = $1", sid
    )
    lang_rows = await db.fetch(
        "SELECT language, COUNT(*) as cnt FROM ci_symbol_nodes WHERE snapshot_id = $1 GROUP BY language",
        sid,
    )
    languages = {r["language"]: r["cnt"] for r in lang_rows}

    return {
        "total_files": file_count or 0,
        "total_symbols": sym_count or 0,
        "total_relations": rel_count or 0,
        "languages": languages,
        "top_complexity": [],
    }


# ---------------------------------------------------------------------------
# Code Intelligence
# ---------------------------------------------------------------------------

@app.get("/repositories/{repo_id}/symbols/search", response_model=SymbolSearchResponse)
async def search_symbols(
    repo_id: str,
    q: str = Query(..., min_length=1, description="Search query"),
    type: str | None = Query(None, description="Symbol kind filter"),
    limit: int = Query(50, ge=1, le=500),
):
    db = _ensure_pool()
    repo = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not repo:
        raise HTTPException(404, "Repository not found")

    # Try CGC engine for live search
    engine = _get_cgc_engine()
    if engine:
        try:
            symbols = await engine.search_symbols(repo["url"], q, kind=type)
            results = [
                {
                    "id": "",
                    "snapshot_id": "",
                    "fq_name": s.name,
                    "name": s.name,
                    "kind": s.kind,
                    "file_path": s.file_path,
                    "line_number": s.line_number,
                    "language": s.language,
                    "metadata": {},
                }
                for s in symbols[:limit]
            ]
            return {"symbols": results, "total": len(symbols)}
        except Exception as exc:
            logger.warning("CGC symbol search failed, falling back to DB", error=str(exc))

    # Fallback: search DB from latest completed snapshot
    latest = await db.fetchrow(
        """
        SELECT s.id FROM ci_repo_snapshots s
        JOIN ci_graph_builds g ON g.snapshot_id = s.id AND g.status = 'COMPLETED'
        WHERE s.repository_id = $1
        ORDER BY s.snapshot_at DESC LIMIT 1
        """,
        repo_id,
    )
    if not latest:
        return {"symbols": [], "total": 0}

    sid = latest["id"]
    search_pattern = f"%{q}%"

    if type:
        rows = await db.fetch(
            """
            SELECT * FROM ci_symbol_nodes
            WHERE snapshot_id = $1 AND kind = $2::symbol_kind
              AND (fq_name ILIKE $3 OR name ILIKE $3)
            ORDER BY name LIMIT $4
            """,
            sid, type, search_pattern, limit,
        )
        total = await db.fetchval(
            """
            SELECT COUNT(*) FROM ci_symbol_nodes
            WHERE snapshot_id = $1 AND kind = $2::symbol_kind
              AND (fq_name ILIKE $3 OR name ILIKE $3)
            """,
            sid, type, search_pattern,
        )
    else:
        rows = await db.fetch(
            """
            SELECT * FROM ci_symbol_nodes
            WHERE snapshot_id = $1
              AND (fq_name ILIKE $2 OR name ILIKE $2)
            ORDER BY name LIMIT $3
            """,
            sid, search_pattern, limit,
        )
        total = await db.fetchval(
            """
            SELECT COUNT(*) FROM ci_symbol_nodes
            WHERE snapshot_id = $1
              AND (fq_name ILIKE $2 OR name ILIKE $2)
            """,
            sid, search_pattern,
        )

    return {"symbols": _rows_to_list(rows), "total": total or 0}


@app.get("/repositories/{repo_id}/impact", response_model=ImpactResponse)
async def get_impact(
    repo_id: str,
    target: str | None = Query(None, description="Target symbol fq_name"),
    file: str | None = Query(None, description="Target file path"),
):
    if not target and not file:
        raise HTTPException(400, "Either 'target' or 'file' query parameter is required")

    db = _ensure_pool()
    repo = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not repo:
        raise HTTPException(404, "Repository not found")

    lookup = target or file or ""

    # Try CGC engine first
    engine = _get_cgc_engine()
    if engine:
        try:
            result = await engine.get_impact_analysis(repo["url"], lookup)
            return {
                "target": result.target,
                "direct": result.direct,
                "transitive": result.transitive,
                "related_tests": result.related_tests,
                "risk_score": result.risk_score,
            }
        except Exception as exc:
            logger.warning("CGC impact analysis failed, falling back to DB", error=str(exc))

    # Fallback: check cached impact analyses in DB
    latest = await db.fetchrow(
        """
        SELECT s.id FROM ci_repo_snapshots s
        JOIN ci_graph_builds g ON g.snapshot_id = s.id AND g.status = 'COMPLETED'
        WHERE s.repository_id = $1
        ORDER BY s.snapshot_at DESC LIMIT 1
        """,
        repo_id,
    )
    if not latest:
        return {
            "target": lookup,
            "direct": [],
            "transitive": [],
            "related_tests": [],
            "risk_score": 0.0,
        }

    sid = latest["id"]

    # Find matching symbol
    symbol = await db.fetchrow(
        "SELECT id FROM ci_symbol_nodes WHERE snapshot_id = $1 AND (fq_name = $2 OR file_path = $2) LIMIT 1",
        sid, lookup,
    )
    if not symbol:
        return {
            "target": lookup,
            "direct": [],
            "transitive": [],
            "related_tests": [],
            "risk_score": 0.0,
        }

    cached = await db.fetchrow(
        "SELECT * FROM ci_impact_analyses WHERE snapshot_id = $1 AND target_symbol_id = $2 ORDER BY created_at DESC LIMIT 1",
        sid, symbol["id"],
    )
    if cached:
        return {
            "target": lookup,
            "direct": _parse_jsonb(cached["direct_impact"]) or [],
            "transitive": _parse_jsonb(cached["transitive_impact"]) or [],
            "related_tests": _parse_jsonb(cached["related_tests"]) or [],
            "risk_score": cached["risk_score"],
        }

    # Compute basic impact from relation edges
    direct_rows = await db.fetch(
        """
        SELECT sn.fq_name FROM ci_relation_edges re
        JOIN ci_symbol_nodes sn ON sn.id = re.to_symbol_id
        WHERE re.snapshot_id = $1 AND re.from_symbol_id = $2
        """,
        sid, symbol["id"],
    )
    direct = [r["fq_name"] for r in direct_rows]

    return {
        "target": lookup,
        "direct": direct,
        "transitive": [],
        "related_tests": [],
        "risk_score": min(len(direct) * 0.1, 1.0),
    }


@app.get("/repositories/{repo_id}/hotspots", response_model=HotspotResponse)
async def get_hotspots(
    repo_id: str,
    metric: str = Query("complexity", description="Metric type"),
    limit: int = Query(20, ge=1, le=100),
):
    db = _ensure_pool()
    repo = await db.fetchrow("SELECT * FROM ci_repositories WHERE id = $1", repo_id)
    if not repo:
        raise HTTPException(404, "Repository not found")

    # Try CGC engine
    engine = _get_cgc_engine()
    if engine:
        try:
            hotspots = await engine.get_complexity_signals(repo["url"], limit=limit)
            return {"hotspots": hotspots[:limit]}
        except Exception as exc:
            logger.warning("CGC hotspots failed, falling back to DB", error=str(exc))

    # Fallback: compute from DB (files with most symbols as a proxy)
    latest = await db.fetchrow(
        """
        SELECT s.id FROM ci_repo_snapshots s
        JOIN ci_graph_builds g ON g.snapshot_id = s.id AND g.status = 'COMPLETED'
        WHERE s.repository_id = $1
        ORDER BY s.snapshot_at DESC LIMIT 1
        """,
        repo_id,
    )
    if not latest:
        return {"hotspots": []}

    sid = latest["id"]
    rows = await db.fetch(
        """
        SELECT file_path, COUNT(*) as symbol_count,
               COUNT(DISTINCT kind) as kind_diversity
        FROM ci_symbol_nodes WHERE snapshot_id = $1
        GROUP BY file_path
        ORDER BY symbol_count DESC
        LIMIT $2
        """,
        sid, limit,
    )
    hotspots = [
        {"file": r["file_path"], "symbol_count": r["symbol_count"], "metric": metric}
        for r in rows
    ]
    return {"hotspots": hotspots}


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------

@app.get("/task-runs/{task_run_id}/context-bundle", response_model=ContextBundleResponse)
async def get_context_bundle(task_run_id: str):
    db = _ensure_pool()
    row = await db.fetchrow(
        "SELECT * FROM ci_context_bundles WHERE task_run_id = $1 ORDER BY created_at DESC LIMIT 1",
        task_run_id,
    )
    if not row:
        raise HTTPException(404, f"No context bundle found for task_run_id '{task_run_id}'")

    bundle = dict(row)
    for field in (
        "primary_targets", "direct_relations", "transitive_impact",
        "related_files", "related_tests", "hotspots", "warnings",
    ):
        bundle[field] = _parse_jsonb(bundle.get(field)) or []
    for key, val in bundle.items():
        if isinstance(val, datetime):
            bundle[key] = val.isoformat()

    return {"context_bundle": bundle}


@app.get("/reviews/{review_id}/structural-findings", response_model=StructuralFindingsResponse)
async def get_structural_findings(review_id: str):
    db = _ensure_pool()
    rows = await db.fetch(
        "SELECT * FROM ci_structural_findings WHERE review_id = $1 ORDER BY created_at DESC",
        review_id,
    )
    findings = []
    for r in rows:
        f = dict(r)
        for field in ("affected_symbols", "affected_files"):
            f[field] = _parse_jsonb(f.get(field)) or []
        f["metrics_delta"] = _parse_jsonb(f.get("metrics_delta"))
        for key, val in f.items():
            if isinstance(val, datetime):
                f[key] = val.isoformat()
        findings.append(f)
    return {"findings": findings}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health():
    # Check DB
    db_status = "unavailable"
    if pool:
        try:
            await pool.fetchval("SELECT 1")
            db_status = "ok"
        except Exception:
            db_status = "error"

    # Check CGC binary
    cgc_status = "unavailable"
    if shutil.which(CGC_BINARY_PATH):
        cgc_status = "ok"
    else:
        engine = _get_cgc_engine()
        if engine is not None:
            cgc_status = "available_via_module"

    overall = "ok" if db_status == "ok" else "degraded"

    return {
        "status": overall,
        "service": "code-intel",
        "db": db_status,
        "cgc": cgc_status,
    }
