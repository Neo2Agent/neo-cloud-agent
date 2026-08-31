#!/usr/bin/env bash
# Build neo-mem0-slim on a machine with RAM, load it onto lighthouse-db, start the slim stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${MEM0_SSH_HOST:-lighthouse-db}"
REMOTE="${MEM0_REMOTE_DIR:-/home/ubuntu/mem0}"
IMAGE="${MEM0_IMAGE:-neo-mem0-slim:1}"

echo "deploy-mem0: build $IMAGE"
docker build -t "$IMAGE" "$ROOT"

echo "deploy-mem0: copy files to $HOST:$REMOTE"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "mkdir -p '$REMOTE' && chmod 700 '$REMOTE'"
rsync -a --delete --exclude '.env' --exclude '__pycache__' --exclude '.pytest_cache' \
  "$ROOT/" "$HOST:$REMOTE/"

echo "deploy-mem0: load image"
docker save "$IMAGE" | gzip | ssh -o BatchMode=yes "$HOST" "gzip -dc | docker load"

echo "deploy-mem0: provision + up"
ssh -o BatchMode=yes "$HOST" "bash '$REMOTE/provision-mem0.sh' && cd '$REMOTE' && docker compose up -d"

echo "deploy-mem0: wait health"
ssh -o BatchMode=yes "$HOST" '
  for i in $(seq 1 40); do
    if curl -fsS --max-time 3 http://127.0.0.1:8888/health | grep -q '"'"'"ok":true'"'"'; then
      echo mem0_health=ok
      exit 0
    fi
    sleep 3
  done
  echo mem0_health=timeout >&2
  docker compose -f /home/ubuntu/mem0/docker-compose.yml logs --tail=80 mem0 mem0-pg >&2 || true
  exit 1
'

echo "deploy-mem0: smoke"
ssh -o BatchMode=yes "$HOST" "bash '$REMOTE/smoke-mem0.sh'"

echo "deploy-mem0: done"
