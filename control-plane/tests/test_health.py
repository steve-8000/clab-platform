"""Health endpoint tests."""


def test_health_returns_ok(client, mock_store):
    mock_store.stats.return_value = {"threads": 5, "runs": 3, "checkpoints": 1, "pending_interrupts": 0}
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "control-plane"
    assert data["threads"] == 5
