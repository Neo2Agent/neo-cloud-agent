#!/usr/bin/env bash
# Copy the slim stack to lighthouse-db. Default: docker build on the db host
# (Tencent mirrors). MEM0_REMOTE_BUILD=0 builds locally and docker-loads.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${MEM0_SSH_HOST:-lighthouse-db}"
REMOTE="${MEM0_REMOTE_DIR:-/home/ubuntu/mem0}"
IMAGE="${MEM0_IMAGE:-neo-mem0-slim:1}"

echo "deploy-mem0: copy files to $HOST:$REMOTE"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "mkdir -p '$REMOTE' && chmod 700 '$REMOTE'"
tar -C "$ROOT" --exclude '.env' --exclude '__pycache__' --exclude '.pytest_cache' -cf - . \
  | ssh -o BatchMode=yes "$HOST" "tar -C '$REMOTE' -xf -"

if [[ "${MEM0_REMOTE_BUILD:-1}" == "1" ]]; then
  echo "deploy-mem0: build $IMAGE on $HOST"
  ssh -o BatchMode=yes "$HOST" "cd '$REMOTE' && docker build -t '$IMAGE' ."
else
  echo "deploy-mem0: build $IMAGE locally and load"
  docker build -t "$IMAGE" "$ROOT"
  docker save "$IMAGE" | gzip -1 | ssh -o BatchMode=yes "$HOST" "gzip -dc | docker load"
fi

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
