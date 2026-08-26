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
from urllib.parse import quote

env_path = Path(".env")
raw = env_path.read_text()
vals: dict[str, str] = {}
for line in raw.splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    vals[key] = value

needed = ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "REDIS_PASSWORD"]
missing = [key for key in needed if not vals.get(key)]
if missing:
    raise SystemExit("provision-new-api: missing keys: " + " ".join(missing))

user = vals["MYSQL_USER"]
password = vals["MYSQL_PASSWORD"]
redis_password = vals["REDIS_PASSWORD"]
dsn = f"{quote(user, safe='')}:{quote(password, safe='')}@tcp(mysql:3306)/newapi?charset=utf8mb4&parseTime=True&loc=Local"
redis = f"redis://:{quote(redis_password, safe='')}@redis:6379/1"

additions: list[str] = []
if not vals.get("NEW_API_SQL_DSN"):
    additions.append(f"NEW_API_SQL_DSN={dsn}")
if not vals.get("NEW_API_REDIS_CONN_STRING"):
    additions.append(f"NEW_API_REDIS_CONN_STRING={redis}")
if not vals.get("NEW_API_SESSION_SECRET"):
    additions.append("NEW_API_SESSION_SECRET=" + secrets.token_urlsafe(32))
if not vals.get("NEW_API_CRYPTO_SECRET"):
    additions.append("NEW_API_CRYPTO_SECRET=" + secrets.token_urlsafe(32))

if additions:
    with env_path.open("a") as fh:
        if not raw.endswith("\n"):
            fh.write("\n")
        fh.write("\n".join(additions) + "\n")
    os.chmod(env_path, 0o600)
    print("provision-new-api: appended", " ".join(item.split("=", 1)[0] for item in additions))
else:
    print("provision-new-api: new-api env keys already present")
PY

set -a
# shellcheck disable=SC1091
. ./.env
set +a

docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" db-mysql mysql -uroot -e "
CREATE DATABASE IF NOT EXISTS newapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON newapi.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
" >/dev/null
echo "provision-new-api: mysql database newapi ready"

docker compose up -d
echo "provision-new-api: compose up requested"
