#!/usr/bin/env bash
# Wire Cloud Agent Secrets onto this VM so `ssh lighthouse` / `ssh lighthouse-db` / tccli work.
# Never print secret values. Missing secrets is OK (exit 0).
set -euo pipefail

SSH_DIR="${HOME}/.ssh"
KEY_FILE="${SSH_DIR}/neo_lighthouse"
CONFIG_FILE="${SSH_DIR}/config"
REGION="${TENCENTCLOUD_REGION:-ap-beijing}"

wrote_ssh=0
have_tccli=0
have_lns=0

normalize_key() {
  local raw="$1"
  raw="${raw%$'\r'}"
  raw="${raw//$'\r'/}"
  if [[ "$raw" != *$'\n'* && "$raw" == *\\n* ]]; then
    printf '%b' "$raw"
    [[ "$raw" == *$'\n' ]] || printf '\n'
    return
  fi
  printf '%s' "$raw"
  [[ "$raw" == *$'\n' ]] || printf '\n'
}

decode_b64_key() {
  local raw="$1"
  raw="${raw%$'\r'}"
  raw="${raw//$'\r'/}"
  raw="${raw//[[:space:]]/}"
  if [[ -z "$raw" ]]; then
    return 1
  fi
  printf '%s' "$raw" | base64 --decode
}

install_lighthouse_identity() {
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  chmod 600 "$KEY_FILE"
  if ! ssh-keygen -y -f "$KEY_FILE" >/dev/null 2>&1; then
    echo "ssh: lighthouse secret is set but is not a usable private key" >&2
    exit 1
  fi
  if [[ -f "$CONFIG_FILE" ]]; then
    awk '
      $1 == "Host" && ($2 == "lighthouse" || $2 == "lighthouse-db") { skip = 1; next }
      skip && $1 == "Host" { skip = 0 }
      !skip { print }
    ' "$CONFIG_FILE" >"${CONFIG_FILE}.tmp"
    mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
  fi
  cat >>"$CONFIG_FILE" <<EOF
Host lighthouse
  HostName 62.234.211.200
  User ubuntu
  IdentityFile ${KEY_FILE}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
Host lighthouse-db
  HostName 101.42.105.230
  User ubuntu
  IdentityFile ${KEY_FILE}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chmod 600 "$CONFIG_FILE"
  wrote_ssh=1
}

if [[ -n "${NEO_LIGHTHOUSE_SSH_KEY_B64:-}" ]]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  if ! decode_b64_key "$NEO_LIGHTHOUSE_SSH_KEY_B64" >"$KEY_FILE" 2>/dev/null; then
    echo "ssh: NEO_LIGHTHOUSE_SSH_KEY_B64 is set but is not valid base64" >&2
    exit 1
  fi
  if [[ ! -s "$KEY_FILE" ]]; then
    echo "ssh: NEO_LIGHTHOUSE_SSH_KEY_B64 decoded to an empty key" >&2
    exit 1
  fi
  # OpenSSH PEM needs a trailing newline; base64 payloads sometimes omit it.
  if [[ "$(tail -c 1 "$KEY_FILE" | wc -l)" -eq 0 ]]; then
    printf '\n' >>"$KEY_FILE"
  fi
  install_lighthouse_identity
elif [[ -n "${NEO_LIGHTHOUSE_SSH_KEY:-}" ]]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  normalize_key "$NEO_LIGHTHOUSE_SSH_KEY" >"$KEY_FILE"
  install_lighthouse_identity
fi

if [[ -n "${TENCENTCLOUD_SECRET_ID:-}" && -n "${TENCENTCLOUD_SECRET_KEY:-}" ]]; then
  have_tccli=1
  export TENCENTCLOUD_REGION="$REGION"
fi

if [[ -n "${TENCENTCLOUD_LNS_SECRET_ID:-}" && -n "${TENCENTCLOUD_LNS_SECRET_KEY:-}" ]]; then
  have_lns=1
fi

if [[ "$wrote_ssh" -eq 1 ]]; then
  echo "ssh: lighthouse + lighthouse-db identity installed"
else
  echo "ssh: NEO_LIGHTHOUSE_SSH_KEY_B64 missing (skip)"
fi
if [[ "$have_tccli" -eq 1 ]]; then
  echo "tccli: credentials present region=${REGION}"
else
  echo "tccli: TENCENTCLOUD_SECRET_ID/KEY missing (skip)"
fi
if [[ "$have_lns" -eq 1 ]]; then
  echo "tccli-lns: credentials present (db account)"
else
  echo "tccli-lns: TENCENTCLOUD_LNS_SECRET_ID/KEY missing (skip)"
fi
