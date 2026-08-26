#!/usr/bin/env bash
# Local checks for bootstrap-agent-access.sh. Never prints key material.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.cursor/skills/tencent-lighthouse-deploy/bootstrap-agent-access.sh"
WORKDIR="$(mktemp -d)"
KEY_SRC="$WORKDIR/src_key"
trap 'rm -rf "$WORKDIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

ssh-keygen -t ed25519 -f "$KEY_SRC" -C bootstrap-test -N "" -q
EXPECTED_FP="$(ssh-keygen -lf "$KEY_SRC" | awk '{print $2}')"
B64="$(base64 -w0 "$KEY_SRC")"

run_bootstrap() {
  local home="$1"
  shift
  mkdir -p "$home"
  local -a unset_cloud=()
  local name
  while IFS= read -r name; do
    unset_cloud+=(-u "$name")
  done < <(env | awk -F= '/^TENCENTCLOUD_/ { print $1 }')
  HOME="$home" env \
    -u NEO_LIGHTHOUSE_SSH_KEY -u NEO_LIGHTHOUSE_SSH_KEY_B64 \
    "${unset_cloud[@]}" \
    "$@" \
    bash "$SCRIPT"
}

# 1) B64 secret installs a usable key + Host lighthouse / lighthouse-db
HOME1="$WORKDIR/home-b64"
OUT="$(run_bootstrap "$HOME1" NEO_LIGHTHOUSE_SSH_KEY_B64="$B64")"
[[ "$OUT" == *"lighthouse + lighthouse-db identity installed"* ]] || fail "b64 did not install identity"
[[ -f "$HOME1/.ssh/neo_lighthouse" ]] || fail "key file missing"
GOT_FP="$(ssh-keygen -lf "$HOME1/.ssh/neo_lighthouse" | awk '{print $2}')"
[[ "$GOT_FP" == "$EXPECTED_FP" ]] || fail "decoded fingerprint mismatch"
grep -q '^Host lighthouse$' "$HOME1/.ssh/config" || fail "Host lighthouse missing"
grep -q 'HostName 62.234.211.200' "$HOME1/.ssh/config" || fail "app HostName missing"
grep -q '^Host lighthouse-db$' "$HOME1/.ssh/config" || fail "Host lighthouse-db missing"
grep -q 'HostName 101.42.105.230' "$HOME1/.ssh/config" || fail "db HostName missing"
[[ "$OUT" == *"TENCENTCLOUD_LNS_SECRET_ID/KEY missing"* ]] || fail "lns missing status"
pass "B64 secret decodes and writes ssh config"

# 2) Invalid B64 exits 1
HOME2="$WORKDIR/home-bad"
if HOME="$HOME2" NEO_LIGHTHOUSE_SSH_KEY_B64="%%%not-base64%%%" bash "$SCRIPT" >/dev/null 2>"$WORKDIR/bad.err"; then
  fail "invalid b64 should fail"
fi
grep -q 'not valid base64' "$WORKDIR/bad.err" || fail "invalid b64 error message"
pass "invalid B64 is rejected"

# 3) Missing secret skips
HOME3="$WORKDIR/home-skip"
OUT="$(run_bootstrap "$HOME3")"
[[ "$OUT" == *"NEO_LIGHTHOUSE_SSH_KEY_B64 missing (skip)"* ]] || fail "missing secret should skip"
[[ ! -e "$HOME3/.ssh/neo_lighthouse" ]] || fail "skip must not write a key"
pass "missing secret skips"

# 4) Legacy plaintext secret still works
HOME4="$WORKDIR/home-plain"
OUT="$(run_bootstrap "$HOME4" NEO_LIGHTHOUSE_SSH_KEY="$(cat "$KEY_SRC")")"
[[ "$OUT" == *"lighthouse + lighthouse-db identity installed"* ]] || fail "plaintext fallback did not install"
GOT_FP="$(ssh-keygen -lf "$HOME4/.ssh/neo_lighthouse" | awk '{print $2}')"
[[ "$GOT_FP" == "$EXPECTED_FP" ]] || fail "plaintext fingerprint mismatch"
pass "legacy plaintext secret still works"

# 5) LNS secrets are reported without writing extra keys
HOME5="$WORKDIR/home-lns"
OUT="$(run_bootstrap "$HOME5" NEO_LIGHTHOUSE_SSH_KEY_B64="$B64" TENCENTCLOUD_LNS_SECRET_ID="id-test" TENCENTCLOUD_LNS_SECRET_KEY="key-test")"
[[ "$OUT" == *"tccli-lns: credentials present (db account)"* ]] || fail "lns present status"
pass "LNS secrets are reported as present"

echo "all bootstrap checks passed"
