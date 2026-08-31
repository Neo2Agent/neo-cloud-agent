import hmac
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import app as slim


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


def test_health_does_not_need_a_key() -> None:
    client = TestClient(slim.app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "neo-mem0-slim"
    assert body["vector"] == "pgvector"


def test_search_rejects_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEM0_API_KEY", "secret-key")
    client = TestClient(slim.app)
    response = client.post("/search", json={"query": "pnpm", "user_id": "u1"})
    assert response.status_code == 401


def test_search_accepts_x_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEM0_API_KEY", "secret-key")
    fake = mock.Mock()
    fake.search.return_value = {"results": [{"memory": "用 pnpm"}]}
    monkeypatch.setattr(slim, "get_memory", lambda: fake)
    client = TestClient(slim.app)
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
