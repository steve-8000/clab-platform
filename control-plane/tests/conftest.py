"""Shared fixtures for control-plane tests."""
import importlib.util
import os
import sys

import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4
from datetime import datetime, timezone

# Register 'control_plane' module from the hyphenated 'control-plane' directory
_cp_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if "control_plane" not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        "control_plane",
        os.path.join(_cp_dir, "__init__.py"),
        submodule_search_locations=[_cp_dir],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["control_plane"] = mod
    spec.loader.exec_module(mod)

# Now submodules can be imported; pre-mock RuntimeStore to avoid DB connection
with patch("control_plane.runtime_store.RuntimeStore._init_schema"):
    with patch("control_plane.runtime_store.RuntimeStore._connect"):
        # Force import of submodules
        importlib.import_module("control_plane.runtime_store")
        importlib.import_module("control_plane.worker_registry")
        importlib.import_module("control_plane.app")

from fastapi.testclient import TestClient


def _make_thread(thread_id=None, worker_id="w1", goal="test", workdir=".", status="CREATED"):
    tid = thread_id or str(uuid4())
    now = datetime.now(tz=timezone.utc).isoformat()
    return {"id": tid, "worker_id": worker_id, "goal": goal, "workdir": workdir,
            "status": status, "created_at": now, "updated_at": now}


def _make_run(run_id=None, thread_id="t1", status="CREATED", step=0):
    rid = run_id or str(uuid4())
    now = datetime.now(tz=timezone.utc).isoformat()
    return {"id": rid, "thread_id": thread_id, "status": status,
            "current_task": None, "step": step, "created_at": now, "updated_at": now}


def _make_event(thread_id="t1", run_id=None, event_type="test", seq=1):
    now = datetime.now(tz=timezone.utc).isoformat()
    return {"id": str(uuid4()), "thread_id": thread_id, "run_id": run_id,
            "seq": seq, "type": event_type, "payload": {}, "ts": now}


def _make_checkpoint(thread_id="t1", checkpoint=None):
    now = datetime.now(tz=timezone.utc).isoformat()
    return {"id": str(uuid4()), "thread_id": thread_id, "run_id": None,
            "node_name": "", "parent_checkpoint_id": None,
            "checkpoint": checkpoint or {"data": "test"}, "metadata": {},
            "created_at": now}


def _make_interrupt(thread_id="t1", run_id=None, value="pause", status="pending"):
    now = datetime.now(tz=timezone.utc).isoformat()
    return {"id": str(uuid4()), "thread_id": thread_id, "run_id": run_id,
            "value": value, "status": status, "resume_value": None,
            "created_at": now, "resolved_at": None}


@pytest.fixture
def mock_store():
    with patch("control_plane.app.store") as m:
        yield m


@pytest.fixture
def mock_registry():
    with patch("control_plane.app.registry") as m:
        m.workers = {}
        m.list_all.return_value = []
        yield m


@pytest.fixture
def client(mock_store, mock_registry):
    from control_plane.app import app
    return TestClient(app)
