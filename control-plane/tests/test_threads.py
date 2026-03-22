"""Thread and Run API tests."""
from tests.conftest import _make_thread, _make_run, _make_event


def test_create_thread(client, mock_store):
    thread = _make_thread()
    event = _make_event(thread_id=thread["id"])
    mock_store.create_thread.return_value = thread
    mock_store.append_event.return_value = event

    resp = client.post("/threads", json={"worker_id": "w1", "goal": "build", "workdir": "."})
    assert resp.status_code == 200
    data = resp.json()
    assert data["thread"]["id"] == thread["id"]
    mock_store.create_thread.assert_called_once()


def test_get_thread(client, mock_store):
    thread = _make_thread(thread_id="t1")
    mock_store.get_thread.return_value = thread

    resp = client.get("/threads/t1")
    assert resp.status_code == 200
    assert resp.json()["id"] == "t1"


def test_get_thread_not_found(client, mock_store):
    mock_store.get_thread.return_value = None
    resp = client.get("/threads/missing")
    assert resp.status_code == 404


def test_list_threads(client, mock_store):
    mock_store.list_threads.return_value = [_make_thread(), _make_thread()]
    resp = client.get("/threads")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_create_run(client, mock_store):
    thread = _make_thread(thread_id="t1")
    run = _make_run(thread_id="t1")
    event = _make_event(thread_id="t1")
    mock_store.get_thread.return_value = thread
    mock_store.create_run.return_value = run
    mock_store.append_event.return_value = event

    resp = client.post("/threads/t1/runs", json={})
    assert resp.status_code == 200
    data = resp.json()
    assert data["run"]["thread_id"] == "t1"


def test_create_run_thread_not_found(client, mock_store):
    mock_store.get_thread.return_value = None
    resp = client.post("/threads/missing/runs", json={})
    assert resp.status_code == 404


def test_get_run(client, mock_store):
    run = _make_run(run_id="r1")
    mock_store.get_run.return_value = run
    resp = client.get("/runs/r1")
    assert resp.status_code == 200
    assert resp.json()["id"] == "r1"


def test_update_run(client, mock_store):
    run = _make_run(run_id="r1", status="RUNNING")
    run_updated = {**run, "current_task": "task1"}
    mock_store.update_run.return_value = run_updated
    mock_store.append_event.return_value = _make_event()

    resp = client.patch("/runs/r1", json={"current_task": "task1"})
    assert resp.status_code == 200
    assert resp.json()["current_task"] == "task1"


def test_update_run_invalid_transition(client, mock_store):
    mock_store.update_run.side_effect = ValueError("Invalid transition: COMPLETED -> RUNNING")
    resp = client.patch("/runs/r1", json={"status": "RUNNING"})
    assert resp.status_code == 400
