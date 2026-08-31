#!/usr/bin/env bash
# Hit localhost Mem0 without printing secrets.
set -euo pipefail

DIR="${MEM0_DIR:-/home/ubuntu/mem0}"
BASE="${MEM0_BASE:-http://127.0.0.1:8888}"

python3 - "$DIR" "$BASE" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

dir_path, base = Path(sys.argv[1]), sys.argv[2].rstrip("/")
vals = {}
for line in (dir_path / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        vals[key] = value
key = vals.get("MEM0_API_KEY") or ""
if not key:
    raise SystemExit("smoke-mem0: MEM0_API_KEY missing")

def call(method, path, body=None, auth=True):
    data = None if body is None else json.dumps(body).encode()
    headers = {"content-type": "application/json"}
    if auth:
        headers["X-API-Key"] = key
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        timeout = 180 if path == "/ready" else 60
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw[:200]}
        return exc.code, parsed

status, health = call("GET", "/health", auth=False)
if status != 200 or not health.get("ok"):
    raise SystemExit(f"smoke-mem0: health failed status={status}")
print("smoke-mem0: health_ok embedder=" + str(health.get("embedder")))

status, denied = call("POST", "/search", {"query": "pnpm", "user_id": "smoke"}, auth=False)
if status != 401:
    raise SystemExit(f"smoke-mem0: expected 401 without key, got {status}")
print("smoke-mem0: unauthorized_ok")

status, ready = call("GET", "/ready")
if status != 200 or not ready.get("ok"):
    raise SystemExit(f"smoke-mem0: ready failed status={status} body={ready}")
print("smoke-mem0: ready_ok")

user = "neo_smoke"
text = "我用 pnpm，不要 force push。"
status, added = call(
    "POST",
    "/memories",
    {"user_id": user, "text": text, "infer": False, "metadata": {"source": "smoke"}},
)
if status != 200:
    raise SystemExit(f"smoke-mem0: add failed status={status} body={added}")
print("smoke-mem0: add_ok infer=false")

status, found = call("POST", "/search", {"query": "包管理器是什么", "user_id": user, "limit": 5})
if status != 200:
    raise SystemExit(f"smoke-mem0: search failed status={status} body={found}")
results = found.get("results") if isinstance(found, dict) else None
if results is None and isinstance(found, list):
    results = found
count = len(results or [])
print(f"smoke-mem0: search_ok hits={count}")
if count < 1:
    raise SystemExit("smoke-mem0: search returned no hits")
PY
