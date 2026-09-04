#!/bin/sh
# Guest PID 1 for neo-cloud-agent Firecracker VMs.
# NEO_DRY_RUN=1 skips mounts so the same script can be tested on the host.
set -eu

WORKSPACE="${NEO_WORKSPACE:-/workspace}"
SESSION_DIR="${SESSION_DIR:-$WORKSPACE/.neo/sessions}"

read_json_field() {
  field="$1"
  file="$2"
  tr '\n' ' ' < "$file" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

configure_tap() {
  [ -r /proc/cmdline ] || return 0
  command -v ip >/dev/null 2>&1 || return 0
  for tok in $(cat /proc/cmdline); do
    case "$tok" in
      ip=*)
        ipcfg="${tok#ip=}"
        guest_ip="$(echo "$ipcfg" | cut -d: -f1)"
        host_ip="$(echo "$ipcfg" | cut -d: -f3)"
        if [ -n "$guest_ip" ]; then
          ip link set eth0 up 2>/dev/null || true
          ip addr add "$guest_ip/30" dev eth0 2>/dev/null || true
          if [ -n "$host_ip" ]; then
            ip route add default via "$host_ip" 2>/dev/null || true
          fi
        fi
        ;;
    esac
  done
}

if [ -z "${NEO_DRY_RUN:-}" ]; then
  mkdir -p /proc /sys /dev /tmp "$WORKSPACE" "$SESSION_DIR" /var/neo/logs
  mount -t proc proc /proc 2>/dev/null || true
  mount -t sysfs sysfs /sys 2>/dev/null || true
  mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
  mount -t tmpfs tmpfs /tmp 2>/dev/null || true
  for dev in /dev/vdb /dev/vda2 /dev/nvme1n1; do
    if [ -b "$dev" ]; then
      mount "$dev" "$WORKSPACE" && break
    fi
  done
  configure_tap
  if ! touch /var/neo/.rw-test 2>/dev/null; then
    mkdir -p /tmp/var-neo
    mount --bind /tmp/var-neo /var/neo 2>/dev/null || true
  else
    rm -f /var/neo/.rw-test
  fi
fi

bootstrap="$WORKSPACE/.neo/run-bootstrap.json"
if [ -f "$bootstrap" ]; then
  RUN_ID="${RUN_ID:-$(read_json_field runId "$bootstrap")}"
  LLM_GATEWAY_JWT="${LLM_GATEWAY_JWT:-$(read_json_field jwt "$bootstrap")}"
  CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-$(read_json_field controlPlaneUrl "$bootstrap")}"
  LLM_GATEWAY_URL="${LLM_GATEWAY_URL:-$(read_json_field llmGatewayUrl "$bootstrap")}"
  NEO_MODEL="${NEO_MODEL:-$(read_json_field model "$bootstrap")}"
  WORKSPACE_DIR="${WORKSPACE_DIR:-$(read_json_field workspaceDir "$bootstrap")}"
  WORKER_ROLE="${WORKER_ROLE:-$(read_json_field workerRole "$bootstrap")}"
  NEO_LOOP_URL="${NEO_LOOP_URL:-$(read_json_field neoLoopUrl "$bootstrap")}"
  NEO_LOOP_TOKEN="${NEO_LOOP_TOKEN:-$(read_json_field neoLoopToken "$bootstrap")}"
  export RUN_ID LLM_GATEWAY_JWT CONTROL_PLANE_URL LLM_GATEWAY_URL NEO_MODEL WORKER_ROLE NEO_LOOP_URL NEO_LOOP_TOKEN
fi

export HOME="${HOME:-/tmp}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/cache}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-$WORKSPACE}"
export SESSION_DIR="${SESSION_DIR:-$WORKSPACE_DIR/.neo/sessions}"
mkdir -p "$SESSION_DIR"

if [ -x /opt/neo/worker/start.sh ]; then
  exec /opt/neo/worker/start.sh
fi
if [ -f /opt/neo/worker/index.mjs ] && command -v node >/dev/null 2>&1; then
  exec node /opt/neo/worker/index.mjs
fi
if [ -f "$WORKSPACE/.neo/worker-entry.mjs" ] && command -v node >/dev/null 2>&1; then
  exec node "$WORKSPACE/.neo/worker-entry.mjs"
fi
if [ -n "${NEO_WORKER_CMD:-}" ]; then
  exec /bin/sh -c "$NEO_WORKER_CMD"
fi

echo "neo-worker entry not found" >&2
exit 127
