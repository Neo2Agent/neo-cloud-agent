#!/usr/bin/env bash
# Ship the current checkout to the Beijing Lighthouse app host.
# Incremental by default: compare .deploy-revision, copy only what changed,
# install/build/restart only when those paths need it. Never prints secrets.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PLAN="$HERE/deploy-plan.sh"
BOOTSTRAP="$HERE/bootstrap-agent-access.sh"
UNITS="$HERE/units"
HOST="${DEPLOY_HOST:-lighthouse}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/home/ubuntu/neo-cloud-agent}"
UNITS_TO_RESTART=()

dry_run=0
force_full=0
force_restart=0
no_restart=0
remote_build=0
from_rev="${DEPLOY_FROM_REV:-}"
skip_health=0

usage() {
  cat <<'EOF'
Usage: deploy.sh [options]

Ship this git checkout to ssh host `lighthouse` (62.234.211.200).

  --dry-run         Print the plan only
  --full            Overlay the whole tree (still skips .env / .neo / node_modules)
  --from-rev SHA    Diff against this revision instead of the host .deploy-revision
  --restart         Restart gateway + control-plane + admin-api even if the plan
                    says they are unchanged
  --no-restart      Never restart units
  --remote-build    Build web/admin on the host instead of this machine
  --skip-health     Do not wait for /health after restart
  -h, --help        Show this help

Env: DEPLOY_HOST, DEPLOY_REMOTE_DIR, DEPLOY_FROM_REV
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --full) force_full=1 ;;
    --from-rev)
      from_rev="${2:?--from-rev needs a SHA}"
      shift
      ;;
    --restart) force_restart=1 ;;
    --no-restart) no_restart=1 ;;
    --remote-build) remote_build=1 ;;
    --skip-health) skip_health=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

log() { printf '%s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing $1"
}

use_repo_node() {
  local ver bin
  [[ -f "$ROOT/.nvmrc" ]] || return 0
  ver="$(tr -d '[:space:]' <"$ROOT/.nvmrc")"
  bin="$HOME/.nvm/versions/node/v${ver}/bin"
  if [[ -x "$bin/node" ]]; then
    export PATH="$bin:$PATH"
  fi
}

ssh_h() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"
}

ensure_ssh() {
  if ssh_h 'true' >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x "$BOOTSTRAP" ]]; then
    log "ssh: lighthouse not ready, running bootstrap-agent-access.sh"
    bash "$BOOTSTRAP"
  fi
  ssh_h 'true' >/dev/null 2>&1 || die "cannot ssh $HOST (check NEO_LIGHTHOUSE_SSH_KEY_B64 / Host lighthouse)"
}

is_safe_relpath() {
  local p="$1"
  [[ -n "$p" ]] || return 1
  case "$p" in
    /*|*..*|.env|.env.*|.neo|.neo/*)
      return 1
      ;;
  esac
  return 0
}

plan_get() {
  printf '%s\n' "$PLAN_TEXT" | awk -F= -v k="$1" '$1==k { print $2; exit }'
}

collect_changes() {
  local status old new
  ADD_FILES=()
  DELETE_FILES=()
  while IFS=$'\t' read -r status old new; do
    [[ -n "$status" ]] || continue
    case "$status" in
      D)
        is_safe_relpath "$old" && DELETE_FILES+=("$old")
        ;;
      R*|C*)
        is_safe_relpath "$old" && DELETE_FILES+=("$old")
        is_safe_relpath "$new" && ADD_FILES+=("$new")
        ;;
      *)
        is_safe_relpath "$old" && ADD_FILES+=("$old")
        ;;
    esac
  done < <(git -C "$ROOT" diff --name-status "$1" "$2")
}

need_cmd git
need_cmd ssh
need_cmd tar
need_cmd python3
[[ -d "$ROOT/.git" ]] || die "must run from a git checkout"
[[ -x "$PLAN" ]] || die "missing $PLAN"

LOCAL_REV="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || log "warn: working tree is dirty; only committed HEAD is shipped"

resolve_rev() {
  git -C "$ROOT" rev-parse --verify "${1}^{commit}"
}

if [[ "$dry_run" -eq 1 && -n "$from_rev" ]]; then
  REMOTE_REV="$(resolve_rev "$from_rev")"
else
  ensure_ssh
  if [[ -n "$from_rev" ]]; then
    REMOTE_REV="$(resolve_rev "$from_rev")"
  else
    REMOTE_REV="$(ssh_h "test -f ${REMOTE_DIR}/.deploy-revision && cat ${REMOTE_DIR}/.deploy-revision || true" | tr -d '[:space:]')"
    if [[ -n "$REMOTE_REV" ]] && git -C "$ROOT" cat-file -e "${REMOTE_REV}^{commit}" 2>/dev/null; then
      REMOTE_REV="$(resolve_rev "$REMOTE_REV")"
    fi
  fi
fi

sync_mode="incremental"
if [[ "$force_full" -eq 1 || -z "$REMOTE_REV" ]]; then
  sync_mode="full"
elif ! git -C "$ROOT" cat-file -e "${REMOTE_REV}^{commit}" 2>/dev/null; then
  log "remote rev $REMOTE_REV is not in this checkout; falling back to full overlay"
  sync_mode="full"
elif git -C "$ROOT" merge-base --is-ancestor "$LOCAL_REV" "$REMOTE_REV" && [[ "$LOCAL_REV" != "$REMOTE_REV" ]]; then
  die "host $REMOTE_REV is ahead of this checkout $LOCAL_REV (pull/rebase first, or pass --full)"
elif [[ "$LOCAL_REV" == "$REMOTE_REV" ]]; then
  sync_mode="none"
fi

ADD_FILES=()
DELETE_FILES=()
if [[ "$sync_mode" == "incremental" ]]; then
  collect_changes "$REMOTE_REV" "$LOCAL_REV"
fi

if [[ "$sync_mode" == "full" ]]; then
  PLAN_TEXT="$(bash "$PLAN" --full)"
elif [[ "$sync_mode" == "none" ]]; then
  PLAN_TEXT="$(bash "$PLAN" </dev/null)"
else
  PLAN_TEXT="$(printf '%s\n' "${ADD_FILES[@]}" "${DELETE_FILES[@]}" | bash "$PLAN")"
fi

# If the lockfile is unchanged, skip install even on --full.
if [[ "$(plan_get install)" == "1" && "$sync_mode" != "none" && "$dry_run" -eq 0 ]]; then
  local_lock="$(md5sum "$ROOT/pnpm-lock.yaml" | awk '{print $1}')"
  remote_lock="$(ssh_h "md5sum ${REMOTE_DIR}/pnpm-lock.yaml 2>/dev/null" | awk '{print $1}')"
  if [[ -n "$remote_lock" && "$local_lock" == "$remote_lock" ]]; then
    PLAN_TEXT="$(printf '%s\n' "$PLAN_TEXT" | sed 's/^install=1$/install=0/')"
    log "install: skip (pnpm-lock.yaml unchanged)"
  fi
fi

if [[ "$force_restart" -eq 1 ]]; then
  PLAN_TEXT="$(printf '%s\n' "$PLAN_TEXT" | sed \
    -e 's/^restart_gateway=0$/restart_gateway=1/' \
    -e 's/^restart_control_plane=0$/restart_control_plane=1/' \
    -e 's/^restart_admin_api=0$/restart_admin_api=1/')"
fi
if [[ "$no_restart" -eq 1 ]]; then
  PLAN_TEXT="$(printf '%s\n' "$PLAN_TEXT" | sed \
    -e 's/^restart_gateway=1$/restart_gateway=0/' \
    -e 's/^restart_control_plane=1$/restart_control_plane=0/' \
    -e 's/^restart_admin_api=1$/restart_admin_api=0/')"
fi

log "local=$LOCAL_REV"
log "remote=${REMOTE_REV:-none}"
log "$PLAN_TEXT"
log "files_add=${#ADD_FILES[@]} files_delete=${#DELETE_FILES[@]}"

if [[ "$dry_run" -eq 1 ]]; then
  log "dry-run: no files copied"
  exit 0
fi

use_repo_node
started_at="$SECONDS"

if [[ "$(plan_get build_web)" == "1" || "$(plan_get build_admin)" == "1" ]]; then
  if [[ "$remote_build" -eq 0 ]] && command -v pnpm >/dev/null 2>&1; then
    if [[ "$(plan_get build_web)" == "1" ]]; then
      log "build: web (local)"
      (cd "$ROOT" && pnpm --filter @neo-cloud-agent/web --config.engine-strict=false build)
    fi
    if [[ "$(plan_get build_admin)" == "1" ]]; then
      log "build: admin (local)"
      (cd "$ROOT" && pnpm --filter @neo-cloud-agent/admin-web --config.engine-strict=false build)
    fi
  else
    remote_build=1
    log "build: will run on host"
  fi
fi

sync_started="$SECONDS"
if [[ "$sync_mode" == "full" ]]; then
  log "sync: full overlay -> $HOST:$REMOTE_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -az --delete \
      --exclude='.git/' \
      --exclude='node_modules/' \
      --exclude='.neo/' \
      --exclude='.env' \
      --exclude='.env.*' \
      --exclude='dist/' \
      --exclude='.deploy-revision' \
      --exclude='.pnpm-store/' \
      -e 'ssh -o BatchMode=yes -o ConnectTimeout=10' \
      "$ROOT/" "$HOST:$REMOTE_DIR/"
  else
    tar -C "$ROOT" \
      --exclude=node_modules --exclude=.git \
      --exclude=.neo --exclude=.env --exclude=dist \
      --exclude=.deploy-revision \
      -czf - . \
    | ssh_h "tar -C ${REMOTE_DIR} -xzf -"
  fi
elif [[ "$sync_mode" == "incremental" ]]; then
  if [[ "${#DELETE_FILES[@]}" -gt 0 ]]; then
    log "sync: delete ${#DELETE_FILES[@]} stale paths"
    printf '%s\n' "${DELETE_FILES[@]}" | ssh_h "python3 -c '
import os, sys
root = os.path.abspath(\"${REMOTE_DIR}\")
for line in sys.stdin:
    rel = line.strip()
    if not rel or rel.startswith(\"/\") or \"..\" in rel.split(\"/\"):
        continue
    path = os.path.abspath(os.path.join(root, rel))
    if path == root or not path.startswith(root + os.sep):
        continue
    try:
        os.remove(path)
        print(\"deleted\", rel)
    except FileNotFoundError:
        pass
    except IsADirectoryError:
        pass
'"
  fi
  if [[ "${#ADD_FILES[@]}" -gt 0 ]]; then
    log "sync: copy ${#ADD_FILES[@]} paths"
    if command -v rsync >/dev/null 2>&1; then
      printf '%s\n' "${ADD_FILES[@]}" | rsync -az --files-from=- \
        -e 'ssh -o BatchMode=yes -o ConnectTimeout=10' \
        "$ROOT/" "$HOST:$REMOTE_DIR/"
    else
      printf '%s\n' "${ADD_FILES[@]}" | tar -C "$ROOT" --files-from=- -czf - \
      | ssh_h "tar -C ${REMOTE_DIR} -xzf -"
    fi
  fi
else
  log "sync: skip (already $LOCAL_REV)"
fi

if [[ "$remote_build" -eq 0 ]]; then
  extra_dist=()
  [[ "$(plan_get build_web)" == "1" && -d "$ROOT/packages/web/dist" ]] && extra_dist+=("packages/web/dist")
  [[ "$(plan_get build_admin)" == "1" && -d "$ROOT/packages/admin-web/dist" ]] && extra_dist+=("packages/admin-web/dist")
  if [[ "${#extra_dist[@]}" -gt 0 ]]; then
    log "sync: frontend dist ${extra_dist[*]}"
    if command -v rsync >/dev/null 2>&1; then
      for d in "${extra_dist[@]}"; do
        rsync -az --delete \
          -e 'ssh -o BatchMode=yes -o ConnectTimeout=10' \
          "$ROOT/$d/" "$HOST:$REMOTE_DIR/$d/"
      done
    else
      tar -C "$ROOT" -czf - "${extra_dist[@]}" | ssh_h "tar -C ${REMOTE_DIR} -xzf -"
    fi
  fi
fi
log "sync: $((SECONDS - sync_started))s"

if [[ "$(plan_get update_units)" == "1" ]]; then
  log "units: install templates"
  for unit in neo-llm-gateway.service neo-control-plane.service neo-admin-api.service; do
    scp -q -o BatchMode=yes -o ConnectTimeout=10 "$UNITS/$unit" "$HOST:/tmp/$unit"
    ssh_h "sudo cp /tmp/$unit /etc/systemd/system/$unit && rm -f /tmp/$unit"
  done
  ssh_h "sudo systemctl daemon-reload"
fi

if [[ "$(plan_get install)" == "1" ]]; then
  log "install: pnpm install on host"
  ssh_h "cd ${REMOTE_DIR} && pnpm install"
fi

if [[ "$remote_build" -eq 1 ]]; then
  if [[ "$(plan_get build_web)" == "1" ]]; then
    log "build: web (host)"
    ssh_h "cd ${REMOTE_DIR} && pnpm --filter @neo-cloud-agent/web --config.engine-strict=false build"
  fi
  if [[ "$(plan_get build_admin)" == "1" ]]; then
    log "build: admin (host)"
    ssh_h "cd ${REMOTE_DIR} && pnpm --filter @neo-cloud-agent/admin-web --config.engine-strict=false build"
  fi
fi

ssh_h "printf '%s\n' '$LOCAL_REV' > ${REMOTE_DIR}/.deploy-revision"

UNITS_TO_RESTART=()
[[ "$(plan_get restart_gateway)" == "1" ]] && UNITS_TO_RESTART+=("neo-llm-gateway")
[[ "$(plan_get restart_control_plane)" == "1" ]] && UNITS_TO_RESTART+=("neo-control-plane")
[[ "$(plan_get restart_admin_api)" == "1" ]] && UNITS_TO_RESTART+=("neo-admin-api")

if [[ "${#UNITS_TO_RESTART[@]}" -gt 0 ]]; then
  log "restart: ${UNITS_TO_RESTART[*]}"
  restart_started="$SECONDS"
  ssh_h "sudo systemctl restart ${UNITS_TO_RESTART[*]}"
  log "restart: $((SECONDS - restart_started))s"
else
  log "restart: skip"
fi

if [[ "$skip_health" -eq 0 ]]; then
  log "health: waiting"
  ok=0
  for _ in $(seq 1 45); do
    health="$(ssh_h 'systemctl is-active neo-llm-gateway neo-control-plane neo-admin-api; echo ---; curl -sS --max-time 4 http://127.0.0.1:8080/health; echo; curl -sS --max-time 4 http://127.0.0.1:8081/health; echo; curl -sS --max-time 4 http://127.0.0.1:8090/health; echo' || true)"
    if printf '%s\n' "$health" | grep -q '"service":"control-plane"' \
      && printf '%s\n' "$health" | grep -q '"service":"llm-gateway"' \
      && printf '%s\n' "$health" | grep -q '"service":"admin-api"'; then
      printf '%s\n' "$health" | python3 -c '
import json, sys
units = []
body = sys.stdin.read().split("---", 1)
print("units", " ".join(body[0].split()))
for line in body[1].splitlines() if len(body) > 1 else []:
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        continue
    svc = data.get("service", "?")
    bits = [f"ok={data.get(\"ok\")}", f"service={svc}"]
    if svc == "control-plane":
        bits += [
            f"runtime={data.get(\"workerRuntime\")}",
            f"slots={(data.get(\"vmSlots\") or {}).get(\"total\")}",
            f"store={data.get(\"metadataStore\")}",
            f"bus={data.get(\"eventBus\")}",
            f"llm={data.get(\"llmConfigured\")}",
        ]
    if svc == "llm-gateway":
        bits += [f"upstream={data.get(\"upstream\")}", f"configured={data.get(\"configured\")}"]
    print(" ".join(str(b) for b in bits))
'
      ok=1
      break
    fi
    sleep 2
  done
  [[ "$ok" -eq 1 ]] || die "health check timed out after restart"
fi

log "done local=$LOCAL_REV total=$((SECONDS - started_at))s"
