#!/bin/sh
set -eu
if [ -f /opt/neo/worker/index.mjs ]; then
  exec node /opt/neo/worker/index.mjs
fi
echo "bake the worker into /opt/neo/worker/index.mjs on the base rootfs" >&2
exit 127
