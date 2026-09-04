import hmac
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import app as slim


OWNED = {
    "id": "m1",
    "memory": "用 pnpm",
    "user_id": "u1",
    "created_at": "2026-09-01T00:00:00.000Z",
    "updated_at": "2026-09-01T00:00:00.000Z",
}


def _client(monkeypatch: pytest.MonkeyPatch, fake: mock.Mock | None = None) -> TestClient:
    monkeypatch.setenv("MEM0_API_KEY", "secret-key")
    if fake is not None:
        monkeypatch.setattr(slim, "get_memory", lambda: fake)
    return TestClient(slim.app)


def test_constants_match_control_plane_contracts() -> None:
    assert slim.MEMORY_LIST_LIMIT_DEFAULT == 50
    assert slim.MEMORY_LIST_LIMIT_MAX == 100
    assert slim.MEMORY_SEARCH_LIMIT_DEFAULT == 8
    assert slim.MEMORY_SEARCH_LIMIT_MAX == 32
    assert slim.MEMORY_TEXT_MAX_LENGTH == 500


def test_memory_config_is_slim_and_local_embedder(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://new-api:3000/v1")
    monkeypatch.setenv("POSTGRES_PASSWORD", "pg-test")
    monkeypatch.setenv("EMBEDDER_MODEL", "BAAI/bge-small-zh-v1.5")
    monkeypatch.setenv("EMBEDDING_DIMS", "512")
    config = slim.memory_config()
    assert config["embedder"]["provider"] == "fastembed"
    assert config["embedder"]["config"]["model"] == "BAAI/bge-small-zh-v1.5"
    assert config["vector_store"]["provider"] == "pgvector"
    assert config["vector_store"]["config"]["hnsw"] is False
    assert config["vector_store"]["config"]["maxconn"] == 2
    assert config["llm"]["config"]["openai_base_url"] == "http://new-api:3000/v1"


def test_health_does_not_need_a_key_and_hides_llm_base() -> None:
    client = TestClient(slim.app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "neo-mem0-slim"
    assert body["vector"] == "pgvector"
    assert "llm_base" not in body
    assert "embedder" in body
    assert "embedding_dims" in body


def test_search_rejects_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEM0_API_KEY", "secret-key")
    client = TestClient(slim.app)
    response = client.post("/search", json={"query": "pnpm", "user_id": "u1"})
    assert response.status_code == 401


def test_search_accepts_x_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.search.return_value = {"results": [{"memory": "用 pnpm"}]}
    client = _client(monkeypatch, fake)
    response = client.post(
        "/search",
        json={"query": "包管理器", "user_id": "u1"},
        headers={"X-API-Key": "secret-key"},
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["memory"] == "用 pnpm"
    fake.search.assert_called_once()
    _args, kwargs = fake.search.call_args
    assert kwargs["filters"] == {"user_id": "u1"}
    assert kwargs["top_k"] == 8


def test_add_infer_defaults_to_false(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.add.return_value = {"results": [{"id": "m1", "memory": "用 pnpm"}]}
    client = _client(monkeypatch, fake)
    response = client.post(
        "/memories",
        json={"user_id": "u1", "text": "用 pnpm"},
        headers={"X-API-Key": "secret-key"},
    )
    assert response.status_code == 200
    _args, kwargs = fake.add.call_args
    assert kwargs["infer"] is False


def test_put_owned_memory_updates_and_returns_results(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    updated = {**OWNED, "memory": "改用 bun", "updated_at": "2026-09-01T00:00:01.000Z"}
    fake.get.side_effect = [OWNED, updated]
    fake.update.return_value = {"message": "updated"}
    client = _client(monkeypatch, fake)
    response = client.put(
        "/memories/m1",
        json={"user_id": "u1", "text": "改用 bun"},
        headers={"X-API-Key": "secret-key"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["memory"] == "改用 bun"
    fake.update.assert_called_once_with("m1", text="改用 bun")
    assert fake.get.call_count == 2


def test_put_other_user_or_missing_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.get.return_value = OWNED
    client = _client(monkeypatch, fake)
    other = client.put(
        "/memories/m1",
        json={"user_id": "u2", "text": "注入"},
        headers={"X-API-Key": "secret-key"},
    )
    assert other.status_code == 404
    fake.update.assert_not_called()

    fake.get.return_value = None
    missing = client.put(
        "/memories/missing",
        json={"user_id": "u1", "text": "注入"},
        headers={"X-API-Key": "secret-key"},
    )
    assert missing.status_code == 404
    fake.update.assert_not_called()


def test_put_rejects_missing_key_and_empty_text(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    client = _client(monkeypatch, fake)
    denied = client.put("/memories/m1", json={"user_id": "u1", "text": "改"})
    assert denied.status_code == 401
    empty = client.put(
        "/memories/m1",
        json={"user_id": "u1", "text": ""},
        headers={"X-API-Key": "secret-key"},
    )
    assert empty.status_code == 422
    fake.update.assert_not_called()


def test_put_updated_at_conflict_is_409(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.get.return_value = OWNED
    client = _client(monkeypatch, fake)
    response = client.put(
        "/memories/m1",
        json={"user_id": "u1", "text": "改用 bun", "updated_at": "2026-09-01T00:00:09.000Z"},
        headers={"X-API-Key": "secret-key"},
    )
    assert response.status_code == 409
    fake.update.assert_not_called()


def test_delete_with_user_id_checks_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.get.return_value = OWNED
    fake.delete.return_value = {"ok": True}
    client = _client(monkeypatch, fake)
    owned = client.delete("/memories/m1?user_id=u1", headers={"X-API-Key": "secret-key"})
    assert owned.status_code == 200
    fake.delete.assert_called_once_with("m1")

    fake.delete.reset_mock()
    other = client.delete("/memories/m1?user_id=u2", headers={"X-API-Key": "secret-key"})
    assert other.status_code == 404
    fake.delete.assert_not_called()


def test_delete_without_user_id_stays_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = mock.Mock()
    fake.delete.return_value = {"ok": True}
    client = _client(monkeypatch, fake)
    response = client.delete("/memories/m1", headers={"X-API-Key": "secret-key"})
    assert response.status_code == 200
    fake.get.assert_not_called()
    fake.delete.assert_called_once_with("m1")


def test_entity_filters_includes_optional_ids() -> None:
    assert slim._entity_filters("u1") == {"user_id": "u1"}
    assert slim._entity_filters("u1", agent_id="a1", run_id="r1") == {
        "user_id": "u1",
        "agent_id": "a1",
        "run_id": "r1",
    }


def test_require_key_uses_constant_time_compare(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEM0_API_KEY", "secret-key")
    with mock.patch("app.hmac.compare_digest", wraps=hmac.compare_digest) as compare:
        slim.require_key("secret-key", None)
        compare.assert_called_once()
