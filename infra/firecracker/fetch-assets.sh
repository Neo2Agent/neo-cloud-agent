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

s3_list() {
  local query="$1"
  curl -fsSL "${S3}?list-type=2&${query}" \
    | tr '<' '\n' \
    | sed -n 's/^Key>//p; s/^Prefix>//p'
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
  versioned="firecracker-ci/${FC_VERSION#v}/${ARCH}/vmlinux-5.10"
  kernel_key="$(s3_list "prefix=${versioned}" | grep '/vmlinux-5\.10' | sort -V | tail -n 1 || true)"
  if [ -z "$kernel_key" ]; then
    prefix="$(s3_list "prefix=firecracker-ci/&delimiter=/" | grep -E '^firecracker-ci/[0-9]{8}-' | sort | tail -n 1 || true)"
    if [ -n "$prefix" ]; then
      kernel_key="$(s3_list "prefix=${prefix}${ARCH}/vmlinux-" | grep '/vmlinux-' | sort -V | tail -n 1 || true)"
    fi
  fi
  if [ -z "$kernel_key" ]; then
    kernel_key="$(s3_list "prefix=firecracker-ci/v1.11/${ARCH}/vmlinux-5.10" | grep '/vmlinux-5\.10' | sort -V | tail -n 1 || true)"
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
