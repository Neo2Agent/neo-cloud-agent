#!/bin/sh
# Guest PID 1 for neo-cloud-agent Firecracker VMs.
# NEO_DRY_RUN=1 skips mounts so the same script can be tested on the host.
set -eu

WORKSPACE="${NEO_WORKSPACE:-/workspace}"
SESSION_DIR="${SESSION_DIR:-/var/neo/sessions}"

read_json_field() {
  field="$1"
  file="$2"
  tr '\n' ' ' < "$file" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

if [ -z "${NEO_DRY_RUN:-}" ]; then
  mkdir -p /proc /sys /dev "$WORKSPACE" "$SESSION_DIR" /var/neo/logs
  mount -t proc proc /proc 2>/dev/null || true
  mount -t sysfs sysfs /sys 2>/dev/null || true
  mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
  for dev in /dev/vdb /dev/vda2 /dev/nvme1n1; do
    if [ -b "$dev" ]; then
      mount "$dev" "$WORKSPACE" && break
    fi
  done
fi

bootstrap="$WORKSPACE/.neo/run-bootstrap.json"
if [ -f "$bootstrap" ]; then
  RUN_ID="${RUN_ID:-$(read_json_field runId "$bootstrap")}"
  LLM_GATEWAY_JWT="${LLM_GATEWAY_JWT:-$(read_json_field jwt "$bootstrap")}"
  CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-$(read_json_field controlPlaneUrl "$bootstrap")}"
  LLM_GATEWAY_URL="${LLM_GATEWAY_URL:-$(read_json_field llmGatewayUrl "$bootstrap")}"
  NEO_MODEL="${NEO_MODEL:-$(read_json_field model "$bootstrap")}"
  WORKSPACE_DIR="${WORKSPACE_DIR:-$(read_json_field workspaceDir "$bootstrap")}"
  export RUN_ID LLM_GATEWAY_JWT CONTROL_PLANE_URL LLM_GATEWAY_URL NEO_MODEL
fi

export WORKSPACE_DIR="${WORKSPACE_DIR:-$WORKSPACE}"
export SESSION_DIR

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
