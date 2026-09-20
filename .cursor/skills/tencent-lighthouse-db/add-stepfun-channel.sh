#!/usr/bin/env bash
# Add a StepFun channel (step-5-preview) next to DeepSeek. Run on lighthouse-db.
# Never prints secrets. Idempotent: existing StepFun channel only gains the model.
# Key source (first match): STEPFUN_API_KEY / STEP_API_KEY env, or KEY_FILE.
set -euo pipefail

DIR="${NEW_API_DIR:-/home/ubuntu/db}"
ADMIN_FILE="${NEW_API_ADMIN_FILE:-$DIR/.new-api-admin}"
BASE="${NEW_API_BASE:-http://127.0.0.1:3000}"
KEY_FILE="${STEPFUN_CHANNEL_KEY_FILE:-$DIR/.stepfun-channel-key}"
CHANNEL_NAME="${STEPFUN_CHANNEL_NAME:-StepFun}"
MODEL_ID="${STEPFUN_MODEL:-step-5-preview}"
BASE_URL="${STEPFUN_BASE_URL:-https://api.stepfun.com}"

cd "$DIR"

if [[ -z "${STEPFUN_API_KEY:-}" && -z "${STEP_API_KEY:-}" && -f "$KEY_FILE" ]]; then
  STEPFUN_API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
fi
if [[ -z "${STEPFUN_API_KEY:-}" && -n "${STEP_API_KEY:-}" ]]; then
  STEPFUN_API_KEY="$STEP_API_KEY"
fi
if [[ -z "${STEPFUN_API_KEY:-}" ]]; then
  echo "add-stepfun-channel: missing STEPFUN_API_KEY / STEP_API_KEY / $KEY_FILE" >&2
  exit 1
fi
if [[ "$STEPFUN_API_KEY" == *$'\n'* ]]; then
  echo "add-stepfun-channel: key must be a single line" >&2
  exit 1
fi
export STEPFUN_API_KEY

python3 - "$BASE" "$ADMIN_FILE" "$CHANNEL_NAME" "$MODEL_ID" "$BASE_URL" <<'PY'
import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

base, admin_file, channel_name, model_id, base_url = sys.argv[1:6]
key = __import__("os").environ.get("STEPFUN_API_KEY", "").strip()
if not key:
    raise SystemExit("add-stepfun-channel: STEPFUN_API_KEY empty after export")

parsed = {}
for line in Path(admin_file).read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        name, value = line.split("=", 1)
        parsed[name] = value
username = parsed.get("NEW_API_ROOT_USER", "root")
password = parsed.get("NEW_API_ROOT_PASSWORD", "")
if not password:
    raise SystemExit("add-stepfun-channel: admin file missing password")

def request(opener, method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"content-type": "application/json", **(headers or {})},
    )
    try:
        with opener.open(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed_body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed_body = {"raw": raw[:120]}
        return exc.code, parsed_body

def channel_items(payload):
    data = payload.get("data")
    if isinstance(data, dict):
        return data.get("items") or data.get("data") or []
    return data if isinstance(data, list) else []

jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
status, body = request(opener, "POST", "/api/user/login", {"username": username, "password": password})
if not body.get("success"):
    raise SystemExit("add-stepfun-channel: login failed: " + str(body.get("message") or status))
payload = body.get("data") or {}
user = payload.get("user") if isinstance(payload.get("user"), dict) else payload
headers = {"New-Api-User": str(user.get("id") or "1")}
access = payload.get("access_token") or payload.get("token") or user.get("token") or ""
if access:
    headers["Authorization"] = "Bearer " + access

status, body = request(opener, "GET", "/api/channel/?p=0&page_size=50", headers=headers)
channels = [item for item in channel_items(body) if isinstance(item, dict)]
existing = next((item for item in channels if str(item.get("name") or "") == channel_name), None)

def model_list(raw):
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]

if existing:
    models = model_list(existing.get("models"))
    if model_id not in models:
        models.append(model_id)
    channel = {
        **existing,
        "models": ",".join(models),
        "base_url": existing.get("base_url") or base_url,
        "key": key,
        "status": 1,
        "group": existing.get("group") or "default",
        "groups": existing.get("groups") or ["default"],
    }
    status, body = request(opener, "PUT", "/api/channel/", {"channel": channel}, headers)
    if not body.get("success"):
        raise SystemExit("add-stepfun-channel: update failed: " + str(body.get("message") or status))
    print("add-stepfun-channel: updated existing channel models=" + ",".join(models))
else:
    status, body = request(
        opener,
        "POST",
        "/api/channel/",
        {
            "mode": "single",
            "channel": {
                "type": 1,
                "name": channel_name,
                "key": key,
                "base_url": base_url,
                "models": model_id,
                "groups": ["default"],
                "group": "default",
                "priority": 0,
                "weight": 0,
                "status": 1,
            },
        },
        headers,
    )
    if not body.get("success"):
        raise SystemExit("add-stepfun-channel: create failed: " + str(body.get("message") or status))
    print("add-stepfun-channel: created channel model=" + model_id)
PY
