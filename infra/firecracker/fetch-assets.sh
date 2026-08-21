#!/usr/bin/env bash
# Download the Firecracker binary and a CI guest kernel into infra/firecracker/.assets.
# Does not build a rootfs; use build-rootfs.sh for the worker image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS="${FIRECRACKER_ASSETS:-$SCRIPT_DIR/.assets}"
FC_VERSION="${FIRECRACKER_VERSION:-v1.16.1}"
ARCH="$(uname -m)"
S3="${FIRECRACKER_S3:-https://s3.amazonaws.com/spec.ccfc.min}"

mkdir -p "$ASSETS"

s3_tags() {
  local query="$1"
  local tag="$2"
  curl -fsSL "${S3}?list-type=2&${query}" \
    | tr '<' '\n' \
    | sed -n "s/^${tag}>//p"
}

pick_kernel_key() {
  s3_tags "$1" Key | grep -E '/vmlinux-[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true
}

download() {
  local url="$1"
  local dest="$2"
  echo "fetch $url"
  curl -fL --retry 4 --retry-delay 2 -o "$dest" "$url"
}

echo "Firecracker ${FC_VERSION} (${ARCH}) -> $ASSETS"

tarball="$ASSETS/firecracker-${FC_VERSION}-${ARCH}.tgz"
if [ ! -x "$ASSETS/firecracker" ]; then
  download \
    "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz" \
    "$tarball"
  tar -xzf "$tarball" -C "$ASSETS"
  found="$(find "$ASSETS" -type f -name "firecracker-${FC_VERSION}-${ARCH}" | head -n 1 || true)"
  if [ -z "$found" ]; then
    found="$(find "$ASSETS" -type f -name 'firecracker-*' ! -name '*.tgz' | head -n 1 || true)"
  fi
  if [ -z "$found" ]; then
    echo "firecracker binary missing from tarball" >&2
    exit 1
  fi
  cp "$found" "$ASSETS/firecracker"
  chmod 755 "$ASSETS/firecracker"
fi

if [ ! -f "$ASSETS/vmlinux" ]; then
  kernel_key=""
  prefix="$(s3_tags "prefix=firecracker-ci/&delimiter=/" Prefix | grep -E '^firecracker-ci/[0-9]{8}-' | sort | tail -n 1 || true)"
  if [ -n "$prefix" ]; then
    kernel_key="$(pick_kernel_key "prefix=${prefix}${ARCH}/vmlinux-5.10")"
    if [ -z "$kernel_key" ]; then
      kernel_key="$(pick_kernel_key "prefix=${prefix}${ARCH}/vmlinux-")"
    fi
  fi
  fc_mm="${FC_VERSION#v}"
  fc_mm="${fc_mm%.*}"
  if [ -z "$kernel_key" ]; then
    kernel_key="$(pick_kernel_key "prefix=firecracker-ci/v${fc_mm}/${ARCH}/vmlinux-5.10")"
  fi
  if [ -z "$kernel_key" ]; then
    kernel_key="$(pick_kernel_key "prefix=firecracker-ci/v1.15/${ARCH}/vmlinux-5.10")"
  fi
  if [ -z "$kernel_key" ]; then
    kernel_key="$(pick_kernel_key "prefix=firecracker-ci/v1.11/${ARCH}/vmlinux-5.10")"
  fi
  if [ -z "$kernel_key" ]; then
    echo "could not list a Firecracker CI vmlinux from $S3" >&2
    exit 1
  fi
  download "${S3}/${kernel_key}" "$ASSETS/vmlinux.partial"
  mv "$ASSETS/vmlinux.partial" "$ASSETS/vmlinux"
  echo "$kernel_key" > "$ASSETS/vmlinux.source"
fi

echo "bin     $ASSETS/firecracker"
echo "kernel  $ASSETS/vmlinux"
"$ASSETS/firecracker" --version | head -n 1 || true
