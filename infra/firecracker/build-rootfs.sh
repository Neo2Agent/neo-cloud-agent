#!/usr/bin/env bash
# Bake neo-cloud-agent-worker:dev (glibc + Node 22 + tsx + worker) into an ext4 rootfs.
# Overlay guest PID 1 / boot / start-worker from this directory.
# Does not run during unit tests; default ensureFirecrackerRootfs() stays a tiny overlay.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSETS="${FIRECRACKER_ASSETS:-$SCRIPT_DIR/.assets}"
IMAGE="${WORKER_IMAGE:-neo-cloud-agent-worker:dev}"
MIN_MIB="${ROOTFS_SIZE_MIB:-1536}"

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
    return
  fi
  sudo -n docker "$@"
}

mkdir -p "$ASSETS"

if ! docker_cmd image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE"
  docker_cmd build -f "$ROOT/infra/Dockerfile.worker" -t "$IMAGE" "$ROOT"
fi

tmp="$(mktemp -d)"
cleanup() {
  if [ -n "${cid:-}" ]; then
    docker_cmd rm -f "$cid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

root="$tmp/root"
mkdir -p "$root"
cid="$(docker_cmd create "$IMAGE")"
docker_cmd export "$cid" | tar -C "$root" -xf -
docker_cmd rm -f "$cid" >/dev/null
cid=""

rm -rf "$root/dev" "$root/proc" "$root/sys" "$root/tmp" "$root/run"
mkdir -p \
  "$root/dev" \
  "$root/proc" \
  "$root/sys" \
  "$root/tmp" \
  "$root/run" \
  "$root/workspace" \
  "$root/opt/neo/worker" \
  "$root/var/neo/sessions" \
  "$root/var/neo/logs"

install -m 0755 "$SCRIPT_DIR/boot.sh" "$root/opt/neo/boot.sh"
install -m 0755 "$SCRIPT_DIR/start-worker.sh" "$root/opt/neo/worker/start.sh"
install -m 0755 "$SCRIPT_DIR/init" "$root/sbin/init"
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$root/etc/resolv.conf"
printf 'neo-worker\n' > "$root/etc/hostname"

if [ ! -x "$root/usr/local/bin/node" ] && [ ! -x "$root/usr/bin/node" ]; then
  echo "exported image is missing node" >&2
  exit 1
fi
if [ ! -f "$root/opt/neo/packages/worker/src/index.ts" ]; then
  echo "exported image is missing /opt/neo/packages/worker/src/index.ts" >&2
  exit 1
fi
if [ ! -x "$root/opt/neo/node_modules/.bin/tsx" ] && [ ! -f "$root/opt/neo/node_modules/tsx/dist/cli.mjs" ]; then
  echo "exported image is missing tsx" >&2
  exit 1
fi
if ! "$root/usr/sbin/ip" -V >/dev/null 2>&1 && ! "$root/sbin/ip" -V >/dev/null 2>&1 && ! "$root/bin/ip" -V >/dev/null 2>&1; then
  echo "exported image is missing iproute2 (ip)" >&2
  exit 1
fi

used_mib="$(du -sm "$root" | awk '{print $1}')"
size_mib="$MIN_MIB"
need_mib="$((used_mib + 384))"
if [ "$size_mib" -lt "$need_mib" ]; then
  size_mib="$need_mib"
fi

image="$ASSETS/rootfs.ext4"
rm -f "$image"
truncate -s "${size_mib}M" "$image"
echo "packing ${used_mib}MiB tree into ${size_mib}MiB $image"
mkfs.ext4 -F -q -b 4096 -i 4096 -d "$root" "$image"
e2fsck -fy "$image" >/dev/null

echo "rootfs  $image"
stat -c 'size    %s bytes' "$image"
