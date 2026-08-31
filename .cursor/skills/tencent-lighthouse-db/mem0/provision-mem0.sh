#!/usr/bin/env bash
# Prepare /home/ubuntu/mem0/.env on lighthouse-db. Never prints secrets.
set -euo pipefail

DIR="${MEM0_DIR:-/home/ubuntu/mem0}"
TOKEN_FILE="${NEW_API_TOKEN_FILE:-/home/ubuntu/db/.new-api-token}"
EXAMPLE="${MEM0_EXAMPLE:-$DIR/.env.example}"

mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR"

if [[ ! -f "$EXAMPLE" ]]; then
  echo "provision-mem0: missing $EXAMPLE" >&2
  exit 1
fi
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "provision-mem0: missing New API token file" >&2
  exit 1
fi

python3 - "$DIR" "$TOKEN_FILE" "$EXAMPLE" <<'PY'
import os
import secrets
import stat
from pathlib import Path

dir_path, token_file, example_path = Path(os.sys.argv[1]), Path(os.sys.argv[2]), Path(os.sys.argv[3])
env_path = dir_path / ".env"

def parse(text: str) -> dict[str, str]:
    vals: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        vals[key] = value
    return vals

raw_token = token_file.read_text().strip()
token = raw_token
if "=" in raw_token and not raw_token.startswith("sk-"):
    parsed_token = parse(raw_token)
    for key, value in parsed_token.items():
        if "TOKEN" in key.upper() or value.startswith("sk-"):
            token = value.strip()
            break
if not token.startswith("sk-"):
    raise SystemExit("provision-mem0: New API token file did not contain a key")

vals = parse(example_path.read_text())
if env_path.exists():
    vals.update(parse(env_path.read_text()))

if not vals.get("POSTGRES_PASSWORD"):
    vals["POSTGRES_PASSWORD"] = secrets.token_urlsafe(24)
if not vals.get("MEM0_API_KEY"):
    vals["MEM0_API_KEY"] = "m0sk_" + secrets.token_urlsafe(32)

vals["POSTGRES_USER"] = vals.get("POSTGRES_USER") or "mem0"
vals["POSTGRES_DB"] = vals.get("POSTGRES_DB") or "mem0"
vals["POSTGRES_COLLECTION_NAME"] = vals.get("POSTGRES_COLLECTION_NAME") or "memories"
vals["MEM0_TELEMETRY"] = "false"
vals["OPENAI_API_KEY"] = token
vals["OPENAI_BASE_URL"] = vals.get("OPENAI_BASE_URL") or "http://new-api:3000/v1"
vals["LLM_MODEL"] = vals.get("LLM_MODEL") or "deepseek-v4-flash"
vals["EMBEDDER_MODEL"] = vals.get("EMBEDDER_MODEL") or "BAAI/bge-small-zh-v1.5"
vals["EMBEDDING_DIMS"] = vals.get("EMBEDDING_DIMS") or "512"

order = [
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_COLLECTION_NAME",
    "MEM0_API_KEY",
    "MEM0_TELEMETRY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "LLM_MODEL",
    "EMBEDDER_MODEL",
    "EMBEDDING_DIMS",
]
lines = ["# Written by provision-mem0.sh. chmod 600. Do not print."]
for key in order:
    lines.append(f"{key}={vals[key]}")
env_path.write_text("\n".join(lines) + "\n")
os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)
print("provision-mem0: env written keys=" + ",".join(order))
print("provision-mem0: openai_base=" + vals["OPENAI_BASE_URL"])
print("provision-mem0: embedder=" + vals["EMBEDDER_MODEL"])
print("provision-mem0: llm=" + vals["LLM_MODEL"])
PY
