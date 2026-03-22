from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


def _install_test_stubs():
    if "asyncpg" not in sys.modules:
        asyncpg_stub = SimpleNamespace(Pool=object, Record=dict, UniqueViolationError=Exception)
        sys.modules["asyncpg"] = asyncpg_stub

    if "structlog" not in sys.modules:
        logger = SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None, error=lambda *a, **k: None)
        sys.modules["structlog"] = SimpleNamespace(get_logger=lambda *_args, **_kwargs: logger)


def _load_code_intel_app_module():
    _install_test_stubs()
    root = Path(__file__).resolve().parents[2]
    package_dir = root / "apps" / "code-intel"

    if "code_intel" not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            "code_intel",
            package_dir / "__init__.py",
            submodule_search_locations=[str(package_dir)],
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules["code_intel"] = module
        spec.loader.exec_module(module)

    app_spec = importlib.util.spec_from_file_location(
        "code_intel.app",
        package_dir / "app.py",
        submodule_search_locations=[str(package_dir)],
    )
    assert app_spec and app_spec.loader
    app_module = importlib.util.module_from_spec(app_spec)
    sys.modules["code_intel.app"] = app_module
    app_spec.loader.exec_module(app_module)
    return app_module


code_intel_app = _load_code_intel_app_module()


def _matches(expected, actual) -> bool:
    if len(expected) != len(actual):
        return False
    return all(exp is ANY or exp == got for exp, got in zip(expected, actual))


def _normalize_query(query: str) -> str:
    return " ".join(query.split())


class FakePool:
    def __init__(self):
        self.fetchrow_expectations: list[tuple[str, tuple[object, ...], object]] = []
        self.fetch_expectations: list[tuple[str, tuple[object, ...], list[object]]] = []
        self.fetchval_expectations: list[tuple[str, tuple[object, ...], object]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def add_fetchrow(self, query: str, args: tuple[object, ...], result: object):
        self.fetchrow_expectations.append((_normalize_query(query), args, result))

    def add_fetch(self, query: str, args: tuple[object, ...], result: list[object]):
        self.fetch_expectations.append((_normalize_query(query), args, result))

    def add_fetchval(self, query: str, args: tuple[object, ...], result: object):
        self.fetchval_expectations.append((_normalize_query(query), args, result))

    async def fetchrow(self, query, *args):
        query = _normalize_query(query)
        for expected_query, expected_args, result in self.fetchrow_expectations:
            if expected_query == query and _matches(expected_args, args):
                return result
        return None

    async def fetch(self, query, *args):
        query = _normalize_query(query)
        for expected_query, expected_args, result in self.fetch_expectations:
            if expected_query == query and _matches(expected_args, args):
                return result
        return []

    async def fetchval(self, query, *args):
        query = _normalize_query(query)
        for expected_query, expected_args, result in self.fetchval_expectations:
            if expected_query == query and _matches(expected_args, args):
                return result
        return None

    async def execute(self, query, *args):
        self.execute_calls.append((query.strip(), args))
        return "OK"


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=code_intel_app.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


def _repo_row(repo_id="repo-1"):
    return {
        "id": repo_id,
        "url": "https://github.com/acme/repo",
        "name": "repo",
        "default_branch": "main",
        "status": "active",
        "created_at": None,
        "updated_at": None,
    }


def test_row_to_dict_parses_jsonb_string_values():
    row = {
        "metadata": "{}",
        "primary_targets": '[{"name":"svc.handler"}]',
        "related_files": '["src/svc.py"]',
        "metrics_delta": '{"fan_out":2}',
    }

    parsed = code_intel_app._row_to_dict(row)

    assert parsed == {
        "metadata": {},
        "primary_targets": [{"name": "svc.handler"}],
        "related_files": ["src/svc.py"],
        "metrics_delta": {"fan_out": 2},
    }


@pytest.mark.asyncio
async def test_repository_crud(client):
    pool = FakePool()
    repo_row = _repo_row()
    insert_query = """
            INSERT INTO ci_repositories (id, url, name, default_branch, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'active', $5, $5)
            RETURNING *
            """
    list_query = "SELECT * FROM ci_repositories ORDER BY created_at DESC"
    get_query = "SELECT * FROM ci_repositories WHERE id = $1"

    pool.add_fetchrow(insert_query, (ANY, "https://github.com/acme/repo", "repo", "main", ANY), repo_row)
    pool.add_fetch(list_query, (), [repo_row])
    pool.add_fetchrow(get_query, ("repo-1",), repo_row)

    with patch.object(code_intel_app, "pool", pool):
        response = await client.post(
            "/repositories",
            json={
                "url": "https://github.com/acme/repo",
                "name": "repo",
                "default_branch": "main",
            },
        )
        assert response.status_code == 200
        assert response.json()["repository"]["name"] == "repo"

        list_response = await client.get("/repositories")
        assert list_response.status_code == 200
        assert list_response.json()["repositories"][0]["id"] == "repo-1"

        get_response = await client.get("/repositories/repo-1")
        assert get_response.status_code == 200
        assert get_response.json()["repository"]["url"] == "https://github.com/acme/repo"


@pytest.mark.asyncio
async def test_delete_repository_endpoint_removes_clone_and_db_row(client):
    pool = FakePool()
    repo_row = _repo_row()
    get_query = "SELECT * FROM ci_repositories WHERE id = $1"

    pool.add_fetchrow(get_query, ("repo-1",), repo_row)

    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app.os.path, "exists", return_value=True
    ) as exists_mock, patch.object(code_intel_app.shutil, "rmtree") as rmtree_mock:
        response = await client.delete("/repositories/repo-1")

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "repo_id": "repo-1"}
    exists_mock.assert_called_once_with(code_intel_app._repo_local_path(repo_row["url"], "repo-1"))
    rmtree_mock.assert_called_once_with(
        code_intel_app._repo_local_path(repo_row["url"], "repo-1"),
        ignore_errors=True,
    )
    assert pool.execute_calls == [("DELETE FROM ci_repositories WHERE id = $1", ("repo-1",))]


@pytest.mark.asyncio
async def test_trigger_index_endpoint(client):
    pool = FakePool()
    repo_row = _repo_row()
    repo_query = "SELECT * FROM ci_repositories WHERE id = $1"
    snapshot_query = """
        INSERT INTO ci_repo_snapshots (id, repository_id, commit_hash, branch, snapshot_at, metadata)
        VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
        RETURNING *
        """
    build_query = """
        INSERT INTO ci_graph_builds (id, snapshot_id, status, engine_type)
        VALUES ($1, $2, 'PENDING', 'cgc_cli')
        RETURNING *
        """
    snapshot_row = {
        "id": "snap-1",
        "repository_id": "repo-1",
        "commit_hash": "HEAD",
        "branch": "main",
        "snapshot_at": None,
        "metadata": {},
    }
    build_row = {
        "id": "build-1",
        "snapshot_id": "snap-1",
        "status": "PENDING",
        "engine_type": "cgc_cli",
    }

    pool.add_fetchrow(repo_query, ("repo-1",), repo_row)
    pool.add_fetchrow(snapshot_query, (ANY, "repo-1", "HEAD", "main", ANY), snapshot_row)
    pool.add_fetchrow(build_query, (ANY, ANY), build_row)

    run_indexing = AsyncMock()
    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app, "_run_indexing", run_indexing
    ):
        response = await client.post("/repositories/repo-1/index", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["message"] == "Indexing started"
        assert body["snapshot"]["id"] == "snap-1"
        run_indexing.assert_awaited_once()


@pytest.mark.asyncio
async def test_symbol_search_endpoint(client):
    pool = FakePool()
    repo_row = _repo_row()
    repo_query = "SELECT * FROM ci_repositories WHERE id = $1"
    symbol = SimpleNamespace(
        name="svc.handler",
        kind="function",
        file_path="src/svc.py",
        line_number=11,
        language="python",
    )

    async def search_symbols(repo_url, q, kind=None):
        assert repo_url == code_intel_app._repo_local_path(repo_row["url"], "repo-1")
        assert q == "svc"
        assert kind is None
        return [symbol]

    engine = SimpleNamespace(search_symbols=search_symbols)

    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app, "_get_cgc_engine", return_value=engine
    ):
        pool.add_fetchrow(repo_query, ("repo-1",), repo_row)
        response = await client.get("/repositories/repo-1/symbols/search", params={"q": "svc"})
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["symbols"][0]["file_path"] == "src/svc.py"


@pytest.mark.asyncio
async def test_impact_analysis_endpoint(client):
    pool = FakePool()
    repo_row = _repo_row()
    repo_query = "SELECT * FROM ci_repositories WHERE id = $1"

    async def get_impact_analysis(repo_url, lookup):
        assert repo_url == code_intel_app._repo_local_path(repo_row["url"], "repo-1")
        assert lookup == "svc.handler"
        return SimpleNamespace(
            target=lookup,
            callers=[],
            callees=["svc.dep"],
            dependents=["svc.deep"],
            importers=["tests/test_svc.py"],
        )

    engine = SimpleNamespace(get_impact_analysis=get_impact_analysis)

    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app, "_get_cgc_engine", return_value=engine
    ):
        pool.add_fetchrow(repo_query, ("repo-1",), repo_row)
        response = await client.get("/repositories/repo-1/impact", params={"target": "svc.handler"})
        assert response.status_code == 200
        body = response.json()
        assert body["direct"] == ["svc.dep"]
        assert body["risk_score"] == 0.1


@pytest.mark.asyncio
async def test_context_bundle_endpoint(client):
    pool = FakePool()
    query = "SELECT * FROM ci_context_bundles WHERE task_run_id = $1 ORDER BY created_at DESC LIMIT 1"
    row = {
        "id": "bundle-1",
        "snapshot_id": "snap-1",
        "task_run_id": "task-1",
        "primary_targets": [{"name": "svc.handler"}],
        "direct_relations": [{"type": "CALLS", "target": "svc.dep"}],
        "transitive_impact": [],
        "related_files": ["src/svc.py"],
        "related_tests": ["tests/test_svc.py"],
        "hotspots": [{"file": "src/svc.py"}],
        "warnings": [],
        "summary": "impact summary",
        "created_at": None,
    }
    pool.add_fetchrow(query, ("task-1",), row)

    with patch.object(code_intel_app, "pool", pool):
        response = await client.get("/task-runs/task-1/context-bundle")
        assert response.status_code == 200
        body = response.json()["context_bundle"]
        assert body["summary"] == "impact summary"
        assert body["related_files"] == ["src/svc.py"]


@pytest.mark.asyncio
async def test_structural_findings_endpoint(client):
    pool = FakePool()
    query = "SELECT * FROM ci_structural_findings WHERE review_id = $1 ORDER BY created_at DESC"
    pool.add_fetch(
        query,
        ("review-1",),
        [
            {
                "id": "finding-1",
                "snapshot_id": "snap-1",
                "review_id": "review-1",
                "finding_type": "NEW_CYCLE",
                "severity": "HIGH",
                "title": "Cycle found",
                "description": "service and adapter now loop",
                "affected_symbols": ["svc.a", "svc.b"],
                "affected_files": ["src/a.py", "src/b.py"],
                "metrics_delta": {"fan_out": 2},
                "recommendation": "break the dependency",
                "created_at": None,
            }
        ],
    )

    with patch.object(code_intel_app, "pool", pool):
        response = await client.get("/reviews/review-1/structural-findings")
        assert response.status_code == 200
        body = response.json()["findings"]
        assert body[0]["severity"] == "HIGH"
        assert body[0]["affected_symbols"] == ["svc.a", "svc.b"]


@pytest.mark.asyncio
async def test_hotspots_endpoint(client):
    pool = FakePool()
    repo_row = _repo_row()
    repo_query = "SELECT * FROM ci_repositories WHERE id = $1"

    async def get_complexity_signals(repo_url, limit=20):
        assert repo_url == code_intel_app._repo_local_path(repo_row["url"], "repo-1")
        assert limit == 20
        return [
            {
                "file": "src/svc.py",
                "file_path": "src/svc.py",
                "symbol_count": 8,
                "complexity": 14,
                "fan_in": 3,
                "fan_out": 5,
                "recent_changes": 2,
                "review_failures": 1,
                "event_coupling": 0,
                "metric_value": 14,
                "metric": "complexity",
            }
        ]

    engine = SimpleNamespace(get_complexity_signals=get_complexity_signals)

    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app, "_get_cgc_engine", return_value=engine
    ):
        pool.add_fetchrow(repo_query, ("repo-1",), repo_row)
        response = await client.get("/repositories/repo-1/hotspots", params={"metric": "complexity"})
        assert response.status_code == 200
        hotspot = response.json()["hotspots"][0]
        assert hotspot["file_path"] == "src/svc.py"
        assert hotspot["metric_value"] == 14


@pytest.mark.asyncio
async def test_health_endpoint(client):
    pool = FakePool()
    pool.add_fetchval("SELECT 1", (), 1)

    with patch.object(code_intel_app, "pool", pool), patch.object(
        code_intel_app, "_get_cgc_engine", return_value=None
    ):
        response = await client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["db"] == "ok"
