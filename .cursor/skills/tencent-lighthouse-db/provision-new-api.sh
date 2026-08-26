#!/usr/bin/env bash
# Prepare /home/ubuntu/db for New API. Run on lighthouse-db. Never prints secrets.
set -euo pipefail

DIR="${NEW_API_DIR:-/home/ubuntu/db}"
cd "$DIR"

if [[ ! -f .env ]]; then
  echo "provision-new-api: missing $DIR/.env" >&2
  exit 1
fi

python3 - <<'PY'
import os
import secrets
from pathlib import Path
from urllib.parse import quote as urlquote

env_path = Path(".env")
raw = env_path.read_text()
vals: dict[str, str] = {}
for line in raw.splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        continue
    key, value = stripped.split("=", 1)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    vals[key] = value

needed = ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "REDIS_PASSWORD"]
missing = [key for key in needed if not vals.get(key)]
if missing:
    raise SystemExit("provision-new-api: missing keys: " + " ".join(missing))

user = vals["MYSQL_USER"]
password = vals["MYSQL_PASSWORD"]
redis_password = vals["REDIS_PASSWORD"]
dsn = f"{urlquote(user, safe='')}:{urlquote(password, safe='')}@tcp(mysql:3306)/newapi?charset=utf8mb4&parseTime=True&loc=Local"
redis = f"redis://:{urlquote(redis_password, safe='')}@redis:6379/1"

def bash_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"

rewritten = False
out_lines = []
seen = set()
for line in raw.splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out_lines.append(line)
        continue
    key, value = stripped.split("=", 1)
    if key in {"NEW_API_SQL_DSN", "NEW_API_REDIS_CONN_STRING", "NEW_API_SESSION_SECRET", "NEW_API_CRYPTO_SECRET"}:
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key == "NEW_API_SQL_DSN":
            value = dsn
        if key == "NEW_API_REDIS_CONN_STRING":
            value = redis
        out_lines.append(f"{key}={bash_quote(value)}")
        seen.add(key)
        rewritten = True
        continue
    out_lines.append(line)

additions: list[str] = []
if "NEW_API_SQL_DSN" not in seen:
    additions.append(f"NEW_API_SQL_DSN={bash_quote(dsn)}")
if "NEW_API_REDIS_CONN_STRING" not in seen:
    additions.append(f"NEW_API_REDIS_CONN_STRING={bash_quote(redis)}")
if "NEW_API_SESSION_SECRET" not in seen:
    additions.append("NEW_API_SESSION_SECRET=" + bash_quote(vals.get("NEW_API_SESSION_SECRET") or secrets.token_urlsafe(32)))
if "NEW_API_CRYPTO_SECRET" not in seen:
    additions.append("NEW_API_CRYPTO_SECRET=" + bash_quote(vals.get("NEW_API_CRYPTO_SECRET") or secrets.token_urlsafe(32)))

if additions or rewritten:
    text = "\n".join(out_lines)
    if not text.endswith("\n"):
        text += "\n"
    if additions:
        text += "\n".join(additions) + "\n"
    env_path.write_text(text)
    os.chmod(env_path, 0o600)
    print("provision-new-api: wrote", " ".join(item.split("=", 1)[0] for item in additions) or "quoted existing keys")
else:
    print("provision-new-api: new-api env keys already present")
PY

python3 - <<'PY'
import os
import subprocess
from pathlib import Path

vals = {}
for line in Path(".env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    vals[key] = value

root = vals["MYSQL_ROOT_PASSWORD"]
user = vals["MYSQL_USER"]
subprocess.run(
    [
        "docker",
        "exec",
        "-e",
        f"MYSQL_PWD={root}",
        "db-mysql",
        "mysql",
        "-uroot",
        "-e",
        f"CREATE DATABASE IF NOT EXISTS newapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON newapi.* TO '{user}'@'%'; FLUSH PRIVILEGES;",
    ],
    check=True,
    stdout=subprocess.DEVNULL,
)
print("provision-new-api: mysql database newapi ready")
PY

docker compose up -d
echo "provision-new-api: compose up requested"
