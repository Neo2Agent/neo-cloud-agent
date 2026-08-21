#!/bin/sh
set -eu

export PATH="/opt/neo/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"
export HOME="${HOME:-/tmp}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/cache}"
export npm_config_cache="${npm_config_cache:-/tmp/npm}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
export SESSION_DIR="${SESSION_DIR:-$WORKSPACE_DIR/.neo/sessions}"
mkdir -p "$SESSION_DIR" /tmp/cache /tmp/npm "$HOME"

if [ -f /opt/neo/worker/index.mjs ]; then
  exec node /opt/neo/worker/index.mjs
fi

WORKER_ENTRY=""
if [ -f /opt/neo/packages/worker/src/index.ts ]; then
  WORKER_ENTRY=/opt/neo/packages/worker/src/index.ts
elif [ -f /opt/neo/src/index.ts ]; then
  WORKER_ENTRY=/opt/neo/src/index.ts
elif [ -f "$WORKSPACE_DIR/packages/worker/src/index.ts" ]; then
  WORKER_ENTRY="$WORKSPACE_DIR/packages/worker/src/index.ts"
fi

if [ -n "$WORKER_ENTRY" ]; then
  if command -v tsx >/dev/null 2>&1; then
    exec tsx "$WORKER_ENTRY"
  fi
  if [ -x /opt/neo/node_modules/.bin/tsx ]; then
    exec /opt/neo/node_modules/.bin/tsx "$WORKER_ENTRY"
  fi
  if [ -f /opt/neo/node_modules/tsx/dist/cli.mjs ]; then
    exec node /opt/neo/node_modules/tsx/dist/cli.mjs "$WORKER_ENTRY"
  fi
fi

echo "bake the worker into /opt/neo/packages/worker or /opt/neo/worker/index.mjs" >&2
exit 127
