#!/usr/bin/env bash
# Point the app-host control-plane at slim Mem0 on the db host.
# Never prints secrets. Opens lighthouse firewall 8888 to the app host only.
set -euo pipefail

APP_HOST="${MEM0_APP_HOST:-lighthouse}"
DB_HOST="${MEM0_DB_HOST:-lighthouse-db}"
APP_DIR="${MEM0_APP_DIR:-/home/ubuntu/neo-cloud-agent}"
MEM0_ENV_FILE="${MEM0_ENV_FILE:-/home/ubuntu/mem0/.env}"
MEM0_URL="${MEM0_URL:-http://101.42.105.230:8888}"
APP_CIDR="${MEM0_APP_CIDR:-62.234.211.200/32}"
INSTANCE_ID="${MEM0_DB_INSTANCE_ID:-lhins-1whwkmau}"
REGION="${TENCENTCLOUD_REGION:-ap-beijing}"
RESTART="${MEM0_RESTART:-1}"

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "wire-mem0: missing $1" >&2; exit 1; }; }
need_cmd ssh
need_cmd scp
need_cmd python3

echo "wire-mem0: bind mem0 on 0.0.0.0:8888"
ssh -o BatchMode=yes "$DB_HOST" '
  set -euo pipefail
  cd /home/ubuntu/mem0
  python3 -c "
from pathlib import Path
p = Path(\"docker-compose.yml\")
text = p.read_text()
old = \"127.0.0.1:8888:8888\"
new = \"0.0.0.0:8888:8888\"
if old in text:
    p.write_text(text.replace(old, new, 1))
    print(\"wire-mem0: compose bind 0.0.0.0:8888\")
else:
    print(\"wire-mem0: compose already not loopback-only\")
"
  docker compose up -d --no-deps mem0
'

if [[ -n "${TENCENTCLOUD_LNS_SECRET_ID:-}" && -n "${TENCENTCLOUD_LNS_SECRET_KEY:-}" ]]; then
  echo "wire-mem0: request firewall 8888 for $APP_CIDR"
  MEM0_DB_INSTANCE_ID="$INSTANCE_ID" MEM0_APP_CIDR="$APP_CIDR" TENCENTCLOUD_REGION="$REGION" python3 - <<'PY' || echo "wire-mem0: firewall API failed (value not printed)"
import os
from tencentcloud.common import credential
from tencentcloud.lighthouse.v20200324 import lighthouse_client, models

cred = credential.Credential(os.environ["TENCENTCLOUD_LNS_SECRET_ID"], os.environ["TENCENTCLOUD_LNS_SECRET_KEY"])
client = lighthouse_client.LighthouseClient(cred, os.environ.get("TENCENTCLOUD_REGION", "ap-beijing"))
listed = models.DescribeFirewallRulesRequest()
listed.InstanceId = os.environ["MEM0_DB_INSTANCE_ID"]
current = client.DescribeFirewallRules(listed)
for item in current.FirewallRuleSet or []:
    if str(getattr(item, "Port", "")) == "8888" and getattr(item, "CidrBlock", "") == os.environ["MEM0_APP_CIDR"]:
        print("wire-mem0: firewall 8888 already present")
        raise SystemExit(0)
req = models.CreateFirewallRulesRequest()
req.InstanceId = os.environ["MEM0_DB_INSTANCE_ID"]
rule = models.FirewallRule()
rule.Protocol = "TCP"
rule.Port = "8888"
rule.CidrBlock = os.environ["MEM0_APP_CIDR"]
rule.Action = "ACCEPT"
rule.FirewallRuleDescription = "mem0 from app host"
req.FirewallRules = [rule]
client.CreateFirewallRules(req)
print("wire-mem0: firewall 8888 created")
PY
else
  echo "wire-mem0: skip firewall API (LNS secrets missing)"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
ssh -o BatchMode=yes "$DB_HOST" "python3 - '$MEM0_ENV_FILE'" <<'PY'
import os, stat, sys
from pathlib import Path
vals = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        vals[key] = value
key = vals.get("MEM0_API_KEY", "").strip()
if not key.startswith("m0sk_"):
    raise SystemExit("wire-mem0: MEM0_API_KEY missing")
out = Path("/tmp/mem0.api-key")
out.write_text(key)
os.chmod(out, stat.S_IRUSR | stat.S_IWUSR)
print("wire-mem0: extracted key prefix", key[:4] + "…", "len", len(key))
PY
scp -q "${DB_HOST}:/tmp/mem0.api-key" "$tmp"
ssh -o BatchMode=yes "$DB_HOST" "rm -f /tmp/mem0.api-key"
python3 - "$tmp" <<'PY'
from pathlib import Path
import sys
key = Path(sys.argv[1]).read_text().strip()
if not key.startswith("m0sk_") or "\n" in key:
    raise SystemExit("wire-mem0: key file invalid")
print("wire-mem0: key copied prefix", key[:4] + "…", "len", len(key))
PY

remote_tmp="/tmp/mem0.api-key"
scp -q "$tmp" "${APP_HOST}:${remote_tmp}"
ssh -o BatchMode=yes "$APP_HOST" "chmod 600 '$remote_tmp'"

ssh -o BatchMode=yes "$APP_HOST" "MEM0_URL='$MEM0_URL' APP_DIR='$APP_DIR' TOKEN_FILE='$remote_tmp' python3 -" <<'PY'
import os
from pathlib import Path

app_dir = Path(os.environ["APP_DIR"])
token_path = Path(os.environ["TOKEN_FILE"])
env_path = app_dir / ".env"
url = os.environ["MEM0_URL"].rstrip("/")
key = token_path.read_text().strip()
token_path.unlink(missing_ok=True)

def upsert(path: Path, updates: dict[str, str]) -> list[str]:
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
        for name in additions:
            out.append(f"{name}={updates[name]}")
            changed.append(name)
    text = "\n".join(out)
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text)
    os.chmod(path, 0o600)
    return changed

changed = upsert(env_path, {"MEM0_URL": url, "MEM0_API_KEY": key})
print("wire-mem0: updated", " ".join(f"env:{name}" for name in changed) or "env:unchanged")
PY

if [[ "$RESTART" == "1" ]]; then
  ssh -o BatchMode=yes "$APP_HOST" 'sudo systemctl restart neo-control-plane'
  echo "wire-mem0: restarted neo-control-plane"
fi
echo "wire-mem0: done"
