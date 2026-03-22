"""Interrupt API tests."""
from tests.conftest import _make_thread, _make_interrupt, _make_event, _make_run


def test_create_interrupt(client, mock_store):
    thread = _make_thread(thread_id="t1")
    intr = _make_interrupt(thread_id="t1")
    mock_store.get_thread.return_value = thread
    mock_store.get_latest_run_for_thread.return_value = _make_run(thread_id="t1")
    mock_store.create_interrupt.return_value = intr
    mock_store.append_event.return_value = _make_event()

    resp = client.post("/interrupts", json={"thread_id": "t1", "value": "pause"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["thread_id"] == "t1"
    assert data["session_id"] == "t1"  # legacy field


def test_create_interrupt_no_thread(client, mock_store):
    resp = client.post("/interrupts", json={"value": "pause"})
    assert resp.status_code == 400


def test_resolve_interrupt(client, mock_store):
    intr = _make_interrupt(thread_id="t1")
    intr["status"] = "resolved"
    intr["resume_value"] = "continue"
    mock_store.resolve_interrupt.return_value = intr
    mock_store.append_event.return_value = _make_event()

    resp = client.post("/interrupts/{}/resolve".format(intr['id']), json={"resume_value": "continue"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"


def test_resolve_interrupt_not_found(client, mock_store):
    mock_store.resolve_interrupt.return_value = None
    resp = client.post("/interrupts/missing/resolve", json={"resume_value": "x"})
    assert resp.status_code == 404


def test_list_interrupts(client, mock_store):
    mock_store.list_interrupts.return_value = [_make_interrupt(), _make_interrupt()]
    resp = client.get("/interrupts?thread_id=t1")
    assert resp.status_code == 200
    assert len(resp.json()) == 2
