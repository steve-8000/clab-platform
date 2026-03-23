"""PostgreSQL-backed runtime store for threads, runs, checkpoints, interrupts, and events."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

RUN_TRANSITIONS = {
    "CREATED": {"RUNNING", "CANCELED", "FAILED"},
    "RUNNING": {"PAUSED", "COMPLETED", "FAILED", "CANCELED"},
    "PAUSED": {"RUNNING", "CANCELED", "FAILED"},
    "COMPLETED": set(),
    "FAILED": {"RUNNING", "CANCELED"},
    "CANCELED": set(),
}


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class RuntimeStore:
    def __init__(self, database_url: str | None = None):
        self.database_url = database_url or os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/clab",
        )
        self._init_schema()

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def _init_schema(self) -> None:
        ddl = """
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL DEFAULT '',
          goal TEXT NOT NULL DEFAULT '',
          workdir TEXT NOT NULL DEFAULT '.',
          status TEXT NOT NULL DEFAULT 'CREATED',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'CREATED',
          current_task TEXT,
          step INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS run_events (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          seq BIGINT NOT NULL,
          type TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          ts TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          node_name TEXT NOT NULL DEFAULT '',
          parent_checkpoint_id TEXT,
          checkpoint JSONB NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS interrupts (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          value TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          resume_value TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          resolved_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          path TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        );

        -- Compatibility migration for pre-existing tables in shared databases.
        ALTER TABLE IF EXISTS threads
          ADD COLUMN IF NOT EXISTS worker_id TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS goal TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS workdir TEXT NOT NULL DEFAULT '.',
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'CREATED',
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

        ALTER TABLE IF EXISTS runs
          ADD COLUMN IF NOT EXISTS thread_id TEXT,
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'CREATED',
          ADD COLUMN IF NOT EXISTS current_task TEXT,
          ADD COLUMN IF NOT EXISTS step INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

        ALTER TABLE IF EXISTS run_events
          ADD COLUMN IF NOT EXISTS thread_id TEXT,
          ADD COLUMN IF NOT EXISTS run_id TEXT,
          ADD COLUMN IF NOT EXISTS seq BIGINT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'event',
          ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;

        ALTER TABLE IF EXISTS checkpoints
          ADD COLUMN IF NOT EXISTS thread_id TEXT,
          ADD COLUMN IF NOT EXISTS run_id TEXT,
          ADD COLUMN IF NOT EXISTS node_name TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS parent_checkpoint_id TEXT,
          ADD COLUMN IF NOT EXISTS checkpoint JSONB,
          ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

        ALTER TABLE IF EXISTS interrupts
          ADD COLUMN IF NOT EXISTS thread_id TEXT,
          ADD COLUMN IF NOT EXISTS run_id TEXT,
          ADD COLUMN IF NOT EXISTS value TEXT,
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS resume_value TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

        ALTER TABLE IF EXISTS artifacts
          ADD COLUMN IF NOT EXISTS thread_id TEXT,
          ADD COLUMN IF NOT EXISTS run_id TEXT,
          ADD COLUMN IF NOT EXISTS type TEXT,
          ADD COLUMN IF NOT EXISTS path TEXT,
          ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

        -- Indexes after compatibility migration (to avoid missing-column failures).
        CREATE INDEX IF NOT EXISTS idx_runs_thread_created ON runs(thread_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_thread_seq ON run_events(thread_id, seq);
        CREATE INDEX IF NOT EXISTS idx_run_events_thread_ts ON run_events(thread_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_created ON checkpoints(thread_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_interrupts_thread_created ON interrupts(thread_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_artifacts_thread_created ON artifacts(thread_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS workers (
          worker_id TEXT PRIMARY KEY,
          hostname TEXT NOT NULL DEFAULT '',
          platform TEXT NOT NULL DEFAULT '',
          capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
          workdir TEXT NOT NULL DEFAULT '.',
          status TEXT NOT NULL DEFAULT 'offline',
          connected_at TIMESTAMPTZ,
          last_heartbeat TIMESTAMPTZ,
          version TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS cmux_workspaces (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'agent',
          status TEXT NOT NULL DEFAULT 'idle',
          current_thread_id TEXT,
          current_run_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_sync_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_cmux_ws_worker ON cmux_workspaces(worker_id);

        CREATE TABLE IF NOT EXISTS cmux_surfaces (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES cmux_workspaces(id) ON DELETE CASCADE,
          surface_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'worker',
          engine TEXT NOT NULL DEFAULT 'codex',
          status TEXT NOT NULL DEFAULT 'idle',
          last_output_excerpt TEXT DEFAULT '',
          last_activity_at TIMESTAMPTZ,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX IF NOT EXISTS idx_cmux_sf_ws ON cmux_surfaces(workspace_id);

        CREATE TABLE IF NOT EXISTS dispatch_commands (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL,
          workspace_id TEXT,
          surface_id TEXT,
          thread_id TEXT,
          run_id TEXT,
          command_type TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'queued',
          created_by TEXT NOT NULL DEFAULT 'dashboard',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_worker ON dispatch_commands(worker_id, status);

        CREATE TABLE IF NOT EXISTS dispatch_results (
          id TEXT PRIMARY KEY,
          command_id TEXT NOT NULL REFERENCES dispatch_commands(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(ddl)
            conn.commit()

    # Threads / Runs
    def create_thread(self, worker_id: str = "", goal: str = "", workdir: str = ".") -> dict:
        tid = str(uuid4())
        return self.create_thread_with_id(tid, worker_id=worker_id, goal=goal, workdir=workdir)

    def create_thread_with_id(self, thread_id: str, worker_id: str = "", goal: str = "", workdir: str = ".") -> dict:
        now = _utc_now()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO threads (id, worker_id, goal, workdir, status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (thread_id, worker_id, goal, workdir, "CREATED", now, now),
            )
            row = cur.fetchone()
            conn.commit()
        return row or {}

    def get_thread(self, thread_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM threads WHERE id=%s;", (thread_id,))
            return cur.fetchone()

    def list_threads(self, status: str | None = None) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            if status:
                cur.execute("SELECT * FROM threads WHERE status=%s ORDER BY created_at DESC;", (status,))
            else:
                cur.execute("SELECT * FROM threads ORDER BY created_at DESC;")
            return cur.fetchall() or []

    def create_run(self, thread_id: str) -> dict:
        now = _utc_now()
        rid = str(uuid4())
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM threads WHERE id=%s;", (thread_id,))
            if not cur.fetchone():
                raise ValueError(f"Thread not found: {thread_id}")
            cur.execute(
                """
                INSERT INTO runs (id, thread_id, status, current_task, step, created_at, updated_at)
                VALUES (%s, %s, %s, NULL, 0, %s, %s)
                RETURNING *;
                """,
                (rid, thread_id, "CREATED", now, now),
            )
            run = cur.fetchone()
            cur.execute(
                "UPDATE threads SET status=%s, updated_at=%s WHERE id=%s;",
                ("RUNNING", now, thread_id),
            )
            conn.commit()
        return run or {}

    def get_run(self, run_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM runs WHERE id=%s;", (run_id,))
            return cur.fetchone()

    def get_latest_run_for_thread(self, thread_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM runs WHERE thread_id=%s ORDER BY created_at DESC LIMIT 1;",
                (thread_id,),
            )
            return cur.fetchone()

    def update_run(self, run_id: str, updates: dict[str, Any]) -> dict | None:
        allowed = {"status", "current_task", "step"}
        values = {k: v for k, v in updates.items() if k in allowed}
        if not values:
            return self.get_run(run_id)

        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM runs WHERE id=%s;", (run_id,))
            run = cur.fetchone()
            if not run:
                return None

            if "status" in values:
                old = run["status"]
                new = values["status"]
                if new not in RUN_TRANSITIONS.get(old, set()):
                    raise ValueError(f"Invalid transition: {old} -> {new}")

            sets = []
            params: list[Any] = []
            for k, v in values.items():
                sets.append(f"{k}=%s")
                params.append(v)
            sets.append("updated_at=%s")
            params.append(_utc_now())
            params.append(run_id)

            cur.execute(
                f"UPDATE runs SET {', '.join(sets)} WHERE id=%s RETURNING *;",
                params,
            )
            updated = cur.fetchone()
            if updated:
                cur.execute(
                    "UPDATE threads SET status=%s, updated_at=%s WHERE id=%s;",
                    (updated["status"], _utc_now(), updated["thread_id"]),
                )
            conn.commit()
            return updated

    # Events
    def append_event(self, thread_id: str, run_id: str | None, event_type: str, payload: dict[str, Any]) -> dict:
        event_id = str(uuid4())
        now = _utc_now()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
                FROM run_events
                WHERE thread_id=%s;
                """,
                (thread_id,),
            )
            row = cur.fetchone() or {}
            seq = int(row.get("next_seq", 1))
            cur.execute(
                """
                INSERT INTO run_events (id, thread_id, run_id, seq, type, payload, ts)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (event_id, thread_id, run_id, seq, event_type, Jsonb(payload), now),
            )
            event = cur.fetchone()
            conn.commit()
            return event or {}

    def list_events(self, thread_id: str, since_seq: int = 0, limit: int = 200) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM run_events
                WHERE thread_id=%s AND seq > %s
                ORDER BY seq ASC
                LIMIT %s;
                """,
                (thread_id, since_seq, limit),
            )
            return cur.fetchall() or []

    # Checkpoints
    def put_checkpoint(self, thread_id: str, checkpoint: dict, metadata: dict | None = None) -> dict:
        md = metadata or {}
        cp_id = checkpoint.get("id") or str(uuid4())
        now = _utc_now()
        run_id = md.get("run_id")
        node_name = md.get("node_name", "")
        parent_checkpoint_id = md.get("parent_checkpoint_id")
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO checkpoints
                (id, thread_id, run_id, node_name, parent_checkpoint_id, checkpoint, metadata, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (
                    cp_id,
                    thread_id,
                    run_id,
                    node_name,
                    parent_checkpoint_id,
                    Jsonb(checkpoint),
                    Jsonb(md),
                    now,
                ),
            )
            saved = cur.fetchone()
            conn.commit()
            return saved or {}

    def get_latest_checkpoint(self, thread_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM checkpoints WHERE thread_id=%s ORDER BY created_at DESC LIMIT 1;",
                (thread_id,),
            )
            return cur.fetchone()

    def list_checkpoints(self, thread_id: str, limit: int = 10) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM checkpoints WHERE thread_id=%s ORDER BY created_at DESC LIMIT %s;",
                (thread_id, limit),
            )
            return cur.fetchall() or []

    def get_checkpoint(self, checkpoint_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM checkpoints WHERE id=%s;", (checkpoint_id,))
            return cur.fetchone()

    # Interrupts
    def create_interrupt(self, thread_id: str, run_id: str | None, value: str) -> dict:
        iid = str(uuid4())
        now = _utc_now()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO interrupts (id, thread_id, run_id, value, status, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (iid, thread_id, run_id, value, "pending", now),
            )
            it = cur.fetchone()
            conn.commit()
            return it or {}

    def get_interrupt(self, interrupt_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM interrupts WHERE id=%s;", (interrupt_id,))
            return cur.fetchone()

    def resolve_interrupt(self, interrupt_id: str, resume_value: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE interrupts
                SET status='resolved', resume_value=%s, resolved_at=%s
                WHERE id=%s
                RETURNING *;
                """,
                (resume_value, _utc_now(), interrupt_id),
            )
            row = cur.fetchone()
            conn.commit()
            return row

    def list_interrupts(
        self,
        *,
        thread_id: str | None = None,
        run_id: str | None = None,
        status: str | None = None,
    ) -> list[dict]:
        where = []
        params: list[Any] = []
        if thread_id:
            where.append("thread_id=%s")
            params.append(thread_id)
        if run_id:
            where.append("run_id=%s")
            params.append(run_id)
        if status:
            where.append("status=%s")
            params.append(status)

        sql = "SELECT * FROM interrupts"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC;"
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() or []

    # Artifacts
    def record_artifact(
        self,
        *,
        thread_id: str,
        run_id: str | None,
        artifact_type: str,
        path: str,
        content: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict:
        aid = str(uuid4())
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO artifacts (id, thread_id, run_id, type, path, content, metadata, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (
                    aid,
                    thread_id,
                    run_id,
                    artifact_type,
                    path,
                    content[:5000],
                    Jsonb(metadata or {}),
                    _utc_now(),
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    def list_artifacts(self, *, thread_id: str | None = None, run_id: str | None = None) -> list[dict]:
        where = []
        params: list[Any] = []
        if thread_id:
            where.append("thread_id=%s")
            params.append(thread_id)
        if run_id:
            where.append("run_id=%s")
            params.append(run_id)
        sql = "SELECT * FROM artifacts"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC;"
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() or []

    # Workers
    async def upsert_worker(
        self,
        worker_id: str,
        hostname: str = "",
        platform: str = "",
        capabilities: list | None = None,
        workdir: str = ".",
        status: str = "online",
        version: str = "",
    ) -> dict:
        now = _utc_now()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO workers
                (worker_id, hostname, platform, capabilities, workdir, status, connected_at, last_heartbeat, version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (worker_id) DO UPDATE SET
                  hostname=EXCLUDED.hostname,
                  platform=EXCLUDED.platform,
                  capabilities=EXCLUDED.capabilities,
                  workdir=EXCLUDED.workdir,
                  status=EXCLUDED.status,
                  last_heartbeat=EXCLUDED.last_heartbeat,
                  version=EXCLUDED.version,
                  connected_at=COALESCE(workers.connected_at, EXCLUDED.connected_at)
                RETURNING *;
                """,
                (worker_id, hostname, platform, Jsonb(capabilities or []), workdir, status, now, now, version),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    async def get_worker(self, worker_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM workers WHERE worker_id=%s;", (worker_id,))
            return cur.fetchone()

    async def list_workers(self, status: str | None = None) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            if status:
                cur.execute("SELECT * FROM workers WHERE status=%s ORDER BY worker_id ASC;", (status,))
            else:
                cur.execute("SELECT * FROM workers ORDER BY worker_id ASC;")
            return cur.fetchall() or []

    async def update_worker_status(self, worker_id: str, status: str) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("UPDATE workers SET status=%s WHERE worker_id=%s;", (status, worker_id))
            conn.commit()

    async def update_worker_heartbeat(self, worker_id: str) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE workers SET last_heartbeat=%s WHERE worker_id=%s;",
                (_utc_now(), worker_id),
            )
            conn.commit()

    # Workspaces
    async def upsert_workspace(
        self,
        id: str,
        worker_id: str,
        workspace_id: str,
        name: str = "",
        role: str = "agent",
        status: str = "idle",
        **kwargs,
    ) -> dict:
        now = _utc_now()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cmux_workspaces
                (id, worker_id, workspace_id, name, role, status, current_thread_id, current_run_id, created_at, updated_at, last_sync_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  worker_id=EXCLUDED.worker_id,
                  workspace_id=EXCLUDED.workspace_id,
                  name=EXCLUDED.name,
                  role=EXCLUDED.role,
                  status=EXCLUDED.status,
                  current_thread_id=EXCLUDED.current_thread_id,
                  current_run_id=EXCLUDED.current_run_id,
                  updated_at=EXCLUDED.updated_at,
                  last_sync_at=EXCLUDED.last_sync_at
                RETURNING *;
                """,
                (
                    id,
                    worker_id,
                    workspace_id,
                    name,
                    role,
                    status,
                    kwargs.get("current_thread_id"),
                    kwargs.get("current_run_id"),
                    kwargs.get("created_at") or now,
                    kwargs.get("updated_at") or now,
                    kwargs.get("last_sync_at") or now,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    async def list_workspaces(self, worker_id: str | None = None) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            if worker_id:
                cur.execute(
                    "SELECT * FROM cmux_workspaces WHERE worker_id=%s ORDER BY updated_at DESC, id ASC;",
                    (worker_id,),
                )
            else:
                cur.execute("SELECT * FROM cmux_workspaces ORDER BY updated_at DESC, id ASC;")
            return cur.fetchall() or []

    async def get_workspace(self, workspace_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM cmux_workspaces WHERE id=%s OR workspace_id=%s ORDER BY updated_at DESC LIMIT 1;",
                (workspace_id, workspace_id),
            )
            return cur.fetchone()

    async def delete_workspaces_for_worker(self, worker_id: str) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM cmux_workspaces WHERE worker_id=%s;", (worker_id,))
            conn.commit()

    # Surfaces
    async def upsert_surface(
        self,
        id: str,
        worker_id: str,
        workspace_id: str,
        surface_id: str,
        name: str = "",
        role: str = "worker",
        engine: str = "codex",
        status: str = "idle",
        last_output_excerpt: str = "",
        **kwargs,
    ) -> dict:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cmux_surfaces
                (id, worker_id, workspace_id, surface_id, name, role, engine, status, last_output_excerpt, last_activity_at, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  worker_id=EXCLUDED.worker_id,
                  workspace_id=EXCLUDED.workspace_id,
                  surface_id=EXCLUDED.surface_id,
                  name=EXCLUDED.name,
                  role=EXCLUDED.role,
                  engine=EXCLUDED.engine,
                  status=EXCLUDED.status,
                  last_output_excerpt=EXCLUDED.last_output_excerpt,
                  last_activity_at=EXCLUDED.last_activity_at,
                  metadata=EXCLUDED.metadata
                RETURNING *;
                """,
                (
                    id,
                    worker_id,
                    workspace_id,
                    surface_id,
                    name,
                    role,
                    engine,
                    status,
                    last_output_excerpt,
                    kwargs.get("last_activity_at") or _utc_now(),
                    Jsonb(kwargs.get("metadata") or {}),
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    async def list_surfaces(self, workspace_id: str) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM cmux_surfaces
                WHERE workspace_id=%s
                   OR workspace_id IN (
                     SELECT id FROM cmux_workspaces WHERE workspace_id=%s
                   )
                ORDER BY last_activity_at DESC NULLS LAST, id ASC;
                """,
                (workspace_id, workspace_id),
            )
            return cur.fetchall() or []

    async def delete_surfaces_for_workspace(self, workspace_id: str) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM cmux_surfaces WHERE workspace_id=%s;", (workspace_id,))
            conn.commit()

    # Dispatch
    async def create_dispatch(
        self,
        worker_id: str,
        command_type: str,
        payload: dict,
        workspace_id: str | None = None,
        surface_id: str | None = None,
        thread_id: str | None = None,
        created_by: str = "dashboard",
    ) -> dict:
        command_id = str(uuid4())
        now = _utc_now()
        run_id = payload.get("run_id") if isinstance(payload, dict) else None
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dispatch_commands
                (id, worker_id, workspace_id, surface_id, thread_id, run_id, command_type, payload, status, created_by, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (
                    command_id,
                    worker_id,
                    workspace_id,
                    surface_id,
                    thread_id,
                    run_id,
                    command_type,
                    Jsonb(payload or {}),
                    "queued",
                    created_by,
                    now,
                    now,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    async def get_dispatch(self, command_id: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM dispatch_commands WHERE id=%s;", (command_id,))
            return cur.fetchone()

    async def update_dispatch_status(self, command_id: str, status: str) -> dict | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE dispatch_commands
                SET status=%s, updated_at=%s
                WHERE id=%s
                RETURNING *;
                """,
                (status, _utc_now(), command_id),
            )
            row = cur.fetchone()
            conn.commit()
            return row

    async def list_dispatches(self, worker_id: str | None = None, status: str | None = None) -> list[dict]:
        where = []
        params: list[Any] = []
        if worker_id:
            where.append("worker_id=%s")
            params.append(worker_id)
        if status:
            where.append("status=%s")
            params.append(status)
        sql = "SELECT * FROM dispatch_commands"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC;"
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() or []

    async def create_dispatch_result(self, command_id: str, status: str, payload: dict | None = None) -> dict:
        result_id = str(uuid4())
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dispatch_results (id, command_id, status, payload, created_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (result_id, command_id, status, Jsonb(payload or {}), _utc_now()),
            )
            row = cur.fetchone()
            conn.commit()
            return row or {}

    def stats(self) -> dict[str, int]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM threads;")
            threads = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM runs;")
            runs = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM checkpoints;")
            checkpoints = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM interrupts WHERE status='pending';")
            pending_interrupts = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM workers;")
            workers = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM cmux_workspaces;")
            workspaces = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM cmux_surfaces;")
            surfaces = int((cur.fetchone() or {}).get("c", 0))
            cur.execute("SELECT COUNT(*) AS c FROM dispatch_commands WHERE status IN ('queued', 'sent', 'acked');")
            pending_dispatches = int((cur.fetchone() or {}).get("c", 0))
            return {
                "threads": threads,
                "runs": runs,
                "checkpoints": checkpoints,
                "pending_interrupts": pending_interrupts,
                "workers": workers,
                "workspaces": workspaces,
                "surfaces": surfaces,
                "pending_dispatches": pending_dispatches,
            }
