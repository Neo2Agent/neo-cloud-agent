#!/usr/bin/env bash
# Copy the New API neo-gateway token onto the app host and point Gateway at :3000/v1.
# Run from a machine that can ssh lighthouse + lighthouse-db. Never prints secrets.
set -euo pipefail

APP_HOST="${NEW_API_APP_HOST:-lighthouse}"
DB_HOST="${NEW_API_DB_HOST:-lighthouse-db}"
APP_DIR="${NEW_API_APP_DIR:-/home/ubuntu/neo-cloud-agent}"
TOKEN_SRC="${NEW_API_TOKEN_FILE:-/home/ubuntu/db/.new-api-token}"
NEW_API_URL="${NEW_API_URL:-http://101.42.105.230:3000}"
NEW_API_CONSOLE_URL="${NEW_API_CONSOLE_URL:-$NEW_API_URL}"
UPSTREAM_BASE="${LLM_UPSTREAM_BASE_URL:-$NEW_API_URL/v1}"
RESTART="${NEW_API_RESTART:-1}"

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "wire-new-api: missing $1" >&2; exit 1; }; }
need_cmd ssh
need_cmd scp
need_cmd python3

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"

scp -q "${DB_HOST}:${TOKEN_SRC}" "$tmp"
python3 - "$tmp" <<'PY'
from pathlib import Path
import sys
key = Path(sys.argv[1]).read_text().strip()
if not key or "\n" in key:
    raise SystemExit("wire-new-api: token file empty or multi-line")
if not key.startswith("sk-"):
    raise SystemExit("wire-new-api: token does not look like sk-")
print("wire-new-api: token copied, prefix", key[:3] + "…", "len", len(key))
PY

remote_tmp="/tmp/new-api-gateway.token"
scp -q "$tmp" "${APP_HOST}:${remote_tmp}"
ssh "$APP_HOST" "chmod 600 '$remote_tmp'"

ssh "$APP_HOST" "NEW_API_URL='$NEW_API_URL' NEW_API_CONSOLE_URL='$NEW_API_CONSOLE_URL' LLM_UPSTREAM_BASE_URL='$UPSTREAM_BASE' APP_DIR='$APP_DIR' TOKEN_FILE='$remote_tmp' python3 -" <<'PY'
import os
from pathlib import Path

app_dir = Path(os.environ["APP_DIR"])
token_path = Path(os.environ["TOKEN_FILE"])
env_path = app_dir / ".env"
upstream_path = app_dir / ".neo" / "llm-upstream.env"
new_api_url = os.environ["NEW_API_URL"].rstrip("/")
console_url = os.environ["NEW_API_CONSOLE_URL"].rstrip("/")
base_url = os.environ["LLM_UPSTREAM_BASE_URL"].rstrip("/")
key = token_path.read_text().strip()
token_path.unlink(missing_ok=True)

def parse_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        out[name] = value
    return out

def upsert(path: Path, updates: dict[str, str], create_comment: str | None = None) -> list[str]:
    raw = path.read_text() if path.exists() else ""
    lines = raw.splitlines()
    seen: set[str] = set()
    changed: list[str] = []
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        name = stripped.split("=", 1)[0]
        if name in updates:
            next_line = f"{name}={updates[name]}"
            if line != next_line:
                changed.append(name)
            out.append(next_line)
            seen.add(name)
            continue
        out.append(line)
    additions = [name for name in updates if name not in seen]
    if additions:
        if out and out[-1] != "":
            out.append("")
        if create_comment and not raw:
            out.append(create_comment)
        for name in additions:
            out.append(f"{name}={updates[name]}")
            changed.append(name)
    text = "\n".join(out)
    if text and not text.endswith("\n"):
        text += "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.chmod(path, 0o600)
    return changed

existing = parse_env(upstream_path.read_text()) if upstream_path.exists() else {}
upstream_updates = {
    "LLM_UPSTREAM": existing.get("LLM_UPSTREAM") or "deepseek",
    "LLM_UPSTREAM_MODEL": existing.get("LLM_UPSTREAM_MODEL") or "deepseek-v4-flash",
    "LLM_UPSTREAM_BASE_URL": base_url,
    "DEEPSEEK_API_KEY": key,
}
changed_upstream = upsert(
    upstream_path,
    upstream_updates,
    "# Written by Neo Cloud Agent. Do not commit.",
)
changed_env = upsert(
    env_path,
    {
        "NEW_API_URL": new_api_url,
        "NEW_API_CONSOLE_URL": console_url,
    },
)
print(
    "wire-new-api: updated",
    " ".join(f"llm-upstream:{name}" for name in changed_upstream)
    or "llm-upstream:unchanged",
    " ".join(f"env:{name}" for name in changed_env) or "env:unchanged",
)
PY

if [[ "$RESTART" == "1" ]]; then
  ssh "$APP_HOST" 'sudo systemctl restart neo-llm-gateway neo-control-plane neo-admin-api'
  echo "wire-new-api: restarted neo-llm-gateway neo-control-plane neo-admin-api"
fi
echo "wire-new-api: done"
