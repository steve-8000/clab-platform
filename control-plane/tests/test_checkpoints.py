"""Checkpoint API tests."""
from tests.conftest import _make_thread, _make_checkpoint, _make_event


def test_put_checkpoint(client, mock_store):
    cp = _make_checkpoint(thread_id="t1")
    mock_store.get_thread.return_value = _make_thread(thread_id="t1")
    mock_store.put_checkpoint.return_value = cp
    mock_store.append_event.return_value = _make_event()

    resp = client.put("/checkpoints/t1", json={"checkpoint": {"data": "test"}, "metadata": {}})
    assert resp.status_code == 200
    assert resp.json()["thread_id"] == "t1"


def test_put_checkpoint_creates_thread_if_missing(client, mock_store):
    mock_store.get_thread.return_value = None
    cp = _make_checkpoint(thread_id="t1")
    mock_store.create_thread_with_id.return_value = _make_thread(thread_id="t1")
    mock_store.put_checkpoint.return_value = cp
    mock_store.append_event.return_value = _make_event()

    resp = client.put("/checkpoints/t1", json={"checkpoint": {"data": "test"}})
    assert resp.status_code == 200


def test_get_checkpoint(client, mock_store):
    cp = _make_checkpoint(thread_id="t1")
    mock_store.get_latest_checkpoint.return_value = cp
    resp = client.get("/checkpoints/t1")
    assert resp.status_code == 200


def test_get_checkpoint_not_found(client, mock_store):
    mock_store.get_latest_checkpoint.return_value = None
    resp = client.get("/checkpoints/missing")
    assert resp.status_code == 404


def test_checkpoint_history(client, mock_store):
    mock_store.list_checkpoints.return_value = [_make_checkpoint(), _make_checkpoint()]
    resp = client.get("/checkpoints/t1/history")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_checkpoint_by_id(client, mock_store):
    cp = _make_checkpoint()
    mock_store.get_checkpoint.return_value = cp
    resp = client.get("/checkpoints/by-id/{}".format(cp['id']))
    assert resp.status_code == 200


def test_get_checkpoint_by_id_not_found(client, mock_store):
    mock_store.get_checkpoint.return_value = None
    resp = client.get("/checkpoints/by-id/missing")
    assert resp.status_code == 404
