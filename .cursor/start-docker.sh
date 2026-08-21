#!/usr/bin/env bash
# Start dockerd on every Cloud Agent boot. Disk state persists; the process does not.
set -euo pipefail

if sudo docker info >/dev/null 2>&1; then
  exit 0
fi

sudo service docker start

for _ in $(seq 1 30); do
  if sudo docker info >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "docker daemon did not become ready" >&2
exit 1
