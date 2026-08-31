"""Slim Mem0 HTTP API: add / search / list / delete. No dashboard."""

from __future__ import annotations

import hmac
import os
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="neo-mem0-slim", docs_url=None, redoc_url=None)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def embedding_dims() -> int:
    raw = _env("EMBEDDING_DIMS", "512")
    try:
        value = int(raw)
    except ValueError:
        value = 512
    return value if value > 0 else 512


def memory_config() -> dict[str, Any]:
    dims = embedding_dims()
    return {
        "llm": {
            "provider": "openai",
            "config": {
                "model": _env("LLM_MODEL", "deepseek-v4-flash"),
                "temperature": 0.1,
                "max_tokens": 800,
                "api_key": _env("OPENAI_API_KEY"),
                "openai_base_url": _env("OPENAI_BASE_URL", "http://new-api:3000/v1"),
            },
        },
        "embedder": {
            "provider": "fastembed",
            "config": {
                "model": _env("EMBEDDER_MODEL", "BAAI/bge-small-zh-v1.5"),
                "embedding_dims": dims,
            },
        },
        "vector_store": {
            "provider": "pgvector",
            "config": {
                "user": _env("POSTGRES_USER", "mem0"),
                "password": _env("POSTGRES_PASSWORD"),
                "host": _env("POSTGRES_HOST", "mem0-pg"),
                "port": int(_env("POSTGRES_PORT", "5432") or "5432"),
                "dbname": _env("POSTGRES_DB", "mem0"),
                "collection_name": _env("POSTGRES_COLLECTION_NAME", "memories"),
                "embedding_model_dims": dims,
                "diskann": False,
                "hnsw": False,
                "minconn": 1,
                "maxconn": 2,
            },
        },
    }


@lru_cache(maxsize=1)
def get_memory():
    from mem0 import Memory

    return Memory.from_config(memory_config())


def require_key(x_api_key: str | None, authorization: str | None) -> None:
    expected = _env("MEM0_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="mem0_api_key_missing")
    provided = (x_api_key or "").strip()
    if not provided and authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer":
            provided = token.strip()
        elif scheme.lower() == "x-api-key":
            provided = token.strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


class AddBody(BaseModel):
    user_id: str = Field(min_length=1)
    messages: str | list[dict[str, str]] | None = None
    text: str | None = None
    infer: bool = True
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None


class SearchBody(BaseModel):
    query: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    limit: int = Field(default=8, ge=1, le=32)
    agent_id: str | None = None
    run_id: str | None = None


def _entity_filters(user_id: str, agent_id: str | None = None, run_id: str | None = None) -> dict[str, Any]:
    filters: dict[str, Any] = {"user_id": user_id}
    if agent_id:
        filters["agent_id"] = agent_id
    if run_id:
        filters["run_id"] = run_id
    return filters


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "neo-mem0-slim",
        "embedder": _env("EMBEDDER_MODEL", "BAAI/bge-small-zh-v1.5"),
        "embedding_dims": embedding_dims(),
        "llm_model": _env("LLM_MODEL", "deepseek-v4-flash"),
        "llm_base": _env("OPENAI_BASE_URL", "http://new-api:3000/v1"),
        "vector": "pgvector",
    }


@app.get("/ready")
def ready(x_api_key: str | None = Header(default=None), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_key(x_api_key, authorization)
    memory = get_memory()
    return {"ok": True, "ready": memory is not None}


@app.post("/memories")
def add_memory(
    body: AddBody,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    payload = body.messages if body.messages is not None else body.text
    if payload is None or payload == "" or payload == []:
        raise HTTPException(status_code=400, detail="messages_or_text_required")
    kwargs: dict[str, Any] = {"user_id": body.user_id, "infer": body.infer}
    if body.agent_id:
        kwargs["agent_id"] = body.agent_id
    if body.run_id:
        kwargs["run_id"] = body.run_id
    if body.metadata:
        kwargs["metadata"] = body.metadata
    return _jsonable(get_memory().add(payload, **kwargs))


@app.post("/search")
def search_memory(
    body: SearchBody,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    memory = get_memory()
    filters = _entity_filters(body.user_id, body.agent_id, body.run_id)
    try:
        return _jsonable(memory.search(body.query, filters=filters, top_k=body.limit))
    except TypeError:
        return _jsonable(memory.search(body.query, user_id=body.user_id, limit=body.limit))


@app.get("/memories")
def list_memories(
    user_id: str,
    limit: int = 50,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    memory = get_memory()
    try:
        return _jsonable(memory.get_all(filters=_entity_filters(user_id), top_k=limit))
    except TypeError:
        return _jsonable(memory.get_all(user_id=user_id, limit=limit))


@app.delete("/memories/{memory_id}")
def delete_memory(
    memory_id: str,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    return _jsonable(get_memory().delete(memory_id))
