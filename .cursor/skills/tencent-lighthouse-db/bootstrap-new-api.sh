#!/usr/bin/env bash
# Initialize New API root, DeepSeek channel, and a gateway token.
# Run on lighthouse-db. Never prints secrets.
# Optional: NEW_API_CHANNEL_KEY_FILE=/path/to/upstream-key (single line).
set -euo pipefail

DIR="${NEW_API_DIR:-/home/ubuntu/db}"
ADMIN_FILE="${NEW_API_ADMIN_FILE:-$DIR/.new-api-admin}"
TOKEN_FILE="${NEW_API_TOKEN_FILE:-$DIR/.new-api-token}"
BASE="${NEW_API_BASE:-http://127.0.0.1:3000}"
CHANNEL_KEY_FILE="${NEW_API_CHANNEL_KEY_FILE:-}"

cd "$DIR"

python3 - "$BASE" "$ADMIN_FILE" "$TOKEN_FILE" "$CHANNEL_KEY_FILE" <<'PY'
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

base, admin_file, token_file, channel_key_file = sys.argv[1:5]
admin_path = Path(admin_file)
token_path = Path(token_file)

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
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return exc.code, parsed

def wait_status():
    for _ in range(60):
        try:
            status, body = request(urllib.request.build_opener(), "GET", "/api/setup")
            if status == 200 and isinstance(body.get("data"), dict):
                return body["data"]
        except Exception:
            pass
        time.sleep(2)
    raise SystemExit("bootstrap-new-api: /api/setup not ready")

setup = wait_status()
username = "root"
password = ""
if admin_path.exists():
    parsed = {}
    for line in admin_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            parsed[key] = value
    username = parsed.get("NEW_API_ROOT_USER", username)
    password = parsed.get("NEW_API_ROOT_PASSWORD", "")

initialized = bool(setup.get("status") or setup.get("root_init"))
if not initialized and not password:
    password = secrets.token_urlsafe(18)
    status, body = request(
        urllib.request.build_opener(),
        "POST",
        "/api/setup",
        {
            "username": username,
            "password": password,
            "confirmPassword": password,
            "SelfUseModeEnabled": True,
            "DemoSiteEnabled": False,
        },
    )
    if not body.get("success") and "已经初始化" not in str(body.get("message") or ""):
        raise SystemExit("bootstrap-new-api: setup failed: " + str(body.get("message") or status))
    admin_path.write_text(
        "NEW_API_ROOT_USER=" + username + "\nNEW_API_ROOT_PASSWORD=" + password + "\n"
    )
    os.chmod(admin_path, 0o600)
    print("bootstrap-new-api: root created")
elif not password:
    raise SystemExit("bootstrap-new-api: already initialized but admin file missing")
else:
    print("bootstrap-new-api: already initialized")

jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
status, body = request(opener, "POST", "/api/user/login", {"username": username, "password": password})
if not body.get("success"):
    raise SystemExit("bootstrap-new-api: login failed: " + str(body.get("message") or status))
payload = body.get("data") or {}
user = payload.get("user") if isinstance(payload.get("user"), dict) else payload
user_id = str(user.get("id") or "1")
access = payload.get("access_token") or payload.get("token") or user.get("token") or ""
headers = {"New-Api-User": user_id}
if access:
    headers["Authorization"] = "Bearer " + access
print("bootstrap-new-api: logged in")

status, body = request(opener, "GET", "/api/channel/?p=0&page_size=20", headers=headers)
channels = ((body.get("data") or {}).get("items") if isinstance(body.get("data"), dict) else body.get("data")) or []
if not isinstance(channels, list):
    channels = []
has_deepseek = any(
    (item.get("type") == 43) or ("deepseek" in str(item.get("name") or "").lower())
    for item in channels
    if isinstance(item, dict)
)
if not has_deepseek:
    if not channel_key_file:
        print("bootstrap-new-api: no channel key file, skip DeepSeek channel")
    else:
        key = Path(channel_key_file).read_text().strip()
        if not key:
            raise SystemExit("bootstrap-new-api: channel key file empty")
        status, body = request(
            opener,
            "POST",
            "/api/channel/",
            {
                "mode": "single",
                "channel": {
                    "type": 43,
                    "name": "DeepSeek",
                    "key": key,
                    "base_url": "https://api.deepseek.com",
                    "models": "deepseek-v4-flash,deepseek-v4-pro,deepseek-v4-flash-vision-exp",
                    "groups": ["default"],
                    "group": "default",
                    "priority": 0,
                    "weight": 0,
                },
            },
            headers,
        )
        if not body.get("success"):
            raise SystemExit("bootstrap-new-api: create channel failed: " + str(body.get("message") or status))
        print("bootstrap-new-api: DeepSeek channel created")
else:
    print("bootstrap-new-api: DeepSeek channel exists")

status, body = request(opener, "GET", "/api/token/?p=0&size=20", headers=headers)
tokens = ((body.get("data") or {}).get("items") if isinstance(body.get("data"), dict) else body.get("data")) or []
if not isinstance(tokens, list):
    tokens = []
def token_items(payload):
    data = payload.get("data")
    if isinstance(data, dict):
        return data.get("items") or data.get("data") or []
    return data if isinstance(data, list) else []

existing = next((item for item in token_items({"data": tokens}) if isinstance(item, dict) and item.get("name") == "neo-gateway"), None)
if existing is None:
    status, body = request(
        opener,
        "POST",
        "/api/token/",
        {
            "name": "neo-gateway",
            "expired_time": -1,
            "unlimited_quota": True,
            "remain_quota": 0,
            "group": "default",
        },
        headers,
    )
    if not body.get("success"):
        raise SystemExit("bootstrap-new-api: create token failed: " + str(body.get("message") or status))
    status, body = request(opener, "GET", "/api/token/?p=0&size=20", headers=headers)
    tokens = token_items(body)
    existing = next((item for item in tokens if isinstance(item, dict) and item.get("name") == "neo-gateway"), None)
    print("bootstrap-new-api: neo-gateway token created")
else:
    print("bootstrap-new-api: neo-gateway token exists")
if not existing or not existing.get("id"):
    raise SystemExit("bootstrap-new-api: token id missing")
status, body = request(opener, "POST", f"/api/token/{existing['id']}/key", headers=headers)
key = ((body.get("data") or {}) if isinstance(body.get("data"), dict) else {}).get("key") or body.get("data") or ""
if not key:
    status, body = request(opener, "POST", "/api/token/batch/keys", {"ids": [existing["id"]]}, headers)
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    keys = data.get("keys") if isinstance(data.get("keys"), dict) else {}
    key = keys.get(str(existing["id"])) or keys.get(existing["id"]) or ""
if not key:
    raise SystemExit("bootstrap-new-api: token key missing: " + str(body.get("message") or status))
if not str(key).startswith("sk-"):
    key = "sk-" + str(key)
token_path.write_text(str(key) + "\n")
os.chmod(token_path, 0o600)
print("bootstrap-new-api: neo-gateway token written")
PY
