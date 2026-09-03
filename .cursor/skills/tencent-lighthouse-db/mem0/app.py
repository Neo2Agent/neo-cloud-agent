"""Slim Mem0 HTTP API: add / search / list / update / delete. No dashboard."""

from __future__ import annotations

import hmac
import os
from datetime import datetime
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# Keep in lockstep with packages/contracts/src/memory.ts
MEMORY_LIST_LIMIT_DEFAULT = 50
MEMORY_LIST_LIMIT_MAX = 100
MEMORY_SEARCH_LIMIT_DEFAULT = 8
MEMORY_SEARCH_LIMIT_MAX = 32
MEMORY_TEXT_MAX_LENGTH = 500

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
    text: str | None = Field(default=None, max_length=MEMORY_TEXT_MAX_LENGTH)
    infer: bool = False
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None


class SearchBody(BaseModel):
    query: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    limit: int = Field(default=MEMORY_SEARCH_LIMIT_DEFAULT, ge=1, le=MEMORY_SEARCH_LIMIT_MAX)
    agent_id: str | None = None
    run_id: str | None = None


class UpdateBody(BaseModel):
    user_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=MEMORY_TEXT_MAX_LENGTH)
    updated_at: str | None = None


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


def _as_record(value: Any) -> dict[str, Any] | None:
    parsed = _jsonable(value)
    if isinstance(parsed, dict) and parsed:
        return parsed
    return None


def _epoch_ms(value: str | None) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).timestamp() * 1000
    except ValueError:
        return None


def _same_updated_at(left: str | None, right: str | None) -> bool:
    left_ms = _epoch_ms(left)
    right_ms = _epoch_ms(right)
    if left_ms is None or right_ms is None:
        return False
    return left_ms == right_ms


def _require_owned_memory(memory_id: str, user_id: str) -> dict[str, Any]:
    try:
        raw = get_memory().get(memory_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="memory_get_failed") from exc
    record = _as_record(raw)
    owner = ""
    if record:
        owner = str(record.get("user_id") or "")
    if not record or owner != user_id:
        raise HTTPException(status_code=404, detail="memory_not_found")
    return record


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "neo-mem0-slim",
        "embedder": _env("EMBEDDER_MODEL", "BAAI/bge-small-zh-v1.5"),
        "embedding_dims": embedding_dims(),
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


@app.put("/memories/{memory_id}")
def update_memory(
    memory_id: str,
    body: UpdateBody,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    record = _require_owned_memory(memory_id, body.user_id)
    if body.updated_at is not None:
        stored = record.get("updated_at")
        stored_text = stored if isinstance(stored, str) else None
        if not _same_updated_at(stored_text, body.updated_at):
            raise HTTPException(status_code=409, detail="version_conflict")
    get_memory().update(memory_id, text=body.text)
    fresh = _as_record(get_memory().get(memory_id))
    if not fresh:
        raise HTTPException(status_code=500, detail="memory_update_missing")
    return {"results": [fresh]}


@app.post("/search")
def search_memory(
    body: SearchBody,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    memory = get_memory()
    filters = _entity_filters(body.user_id, body.agent_id, body.run_id)
    return _jsonable(memory.search(body.query, filters=filters, top_k=body.limit))


@app.get("/memories")
def list_memories(
    user_id: str,
    limit: int = MEMORY_LIST_LIMIT_DEFAULT,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    if limit < 1:
        limit = MEMORY_LIST_LIMIT_DEFAULT
    if limit > MEMORY_LIST_LIMIT_MAX:
        limit = MEMORY_LIST_LIMIT_MAX
    memory = get_memory()
    return _jsonable(memory.get_all(filters=_entity_filters(user_id), top_k=limit))


@app.delete("/memories/{memory_id}")
def delete_memory(
    memory_id: str,
    user_id: str | None = None,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    if user_id:
        _require_owned_memory(memory_id, user_id)
    return _jsonable(get_memory().delete(memory_id))
