#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLAN="$ROOT/.cursor/skills/tencent-lighthouse-deploy/deploy-plan.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

expect() {
  local name="$1" got="$2" want="$3"
  [[ "$got" == *"$want"* ]] || fail "$name: missing $want in"$'\n'"$got"
}

OUT="$(bash "$PLAN" --help)"
expect help "$OUT" "sync=none|incremental|full"

OUT="$(bash "$PLAN" </dev/null)"
expect empty "$OUT" "sync=none"
expect empty "$OUT" "install=0"
expect empty "$OUT" "restart_control_plane=0"
pass "empty input is a no-op"

OUT="$(printf '%s\n' "packages/admin-web/src/App.tsx" "docs/architecture.md" | bash "$PLAN")"
expect admin-web "$OUT" "sync=incremental"
expect admin-web "$OUT" "build_admin=1"
expect admin-web "$OUT" "build_web=0"
expect admin-web "$OUT" "restart_admin_api=0"
expect admin-web "$OUT" "restart_control_plane=0"
pass "admin-web only rebuilds admin UI and skips restarts"

OUT="$(printf '%s\n' "packages/web/src/App.tsx" | bash "$PLAN")"
expect web "$OUT" "build_web=1"
expect web "$OUT" "restart_control_plane=0"
pass "web-only rebuilds chat UI without restarting control-plane"

OUT="$(printf '%s\n' "packages/control-plane/src/index.ts" | bash "$PLAN")"
expect cp "$OUT" "restart_control_plane=1"
expect cp "$OUT" "restart_gateway=0"
expect cp "$OUT" "build_web=0"
pass "control-plane source restarts only the API"

OUT="$(printf '%s\n' "packages/llm-gateway/src/proxy.ts" "pnpm-lock.yaml" | bash "$PLAN")"
expect gw "$OUT" "install=1"
expect gw "$OUT" "restart_gateway=1"
expect gw "$OUT" "restart_control_plane=0"
pass "lockfile + gateway install and restart gateway"

OUT="$(printf '%s\n' "packages/contracts/src/index.ts" | bash "$PLAN")"
expect contracts "$OUT" "build_web=1"
expect contracts "$OUT" "build_admin=1"
expect contracts "$OUT" "restart_gateway=1"
expect contracts "$OUT" "restart_control_plane=1"
expect contracts "$OUT" "restart_admin_api=1"
pass "contracts changes rebuild and restart all app units"

OUT="$(printf '%s\n' ".cursor/skills/tencent-lighthouse-deploy/units/neo-control-plane.service" | bash "$PLAN")"
expect unit "$OUT" "update_units=1"
expect unit "$OUT" "restart_control_plane=1"
pass "control-plane unit file updates systemd and restarts that unit"

OUT="$(printf '%s\n' "docs/architecture.md" "packages/desk/ui/App.tsx" "README.md" | bash "$PLAN")"
expect docs "$OUT" "install=0"
expect docs "$OUT" "build_web=0"
expect docs "$OUT" "restart_control_plane=0"
expect docs "$OUT" "restart_admin_api=0"
pass "docs and Desk UI do not restart production units"

OUT="$(printf '%s\n' ".env" ".neo/llm-upstream.env" "packages/web/dist/index.html" | bash "$PLAN")"
expect skip "$OUT" "install=0"
expect skip "$OUT" "build_web=0"
expect skip "$OUT" "restart_control_plane=0"
pass "secrets and dist paths are ignored"

OUT="$(bash "$PLAN" --full)"
expect full "$OUT" "sync=full"
expect full "$OUT" "install=1"
expect full "$OUT" "build_web=1"
expect full "$OUT" "build_admin=1"
expect full "$OUT" "restart_control_plane=1"
expect full "$OUT" "update_units=1"
pass "--full is the conservative path"

HEALTH="$ROOT/.cursor/skills/tencent-lighthouse-deploy/deploy-health.py"
SAMPLE="$(printf '%s\n' "active" "active" "active" "---" \
  '{"ok":true,"service":"control-plane","workerRuntime":"vm","vmSlots":{"total":2},"metadataStore":"mysql","eventBus":"redis","llmConfigured":true}' \
  '{"ok":true,"service":"llm-gateway","upstream":"deepseek","configured":true}' \
  '{"ok":true,"service":"admin-api"}')"
OUT="$(printf '%s\n' "$SAMPLE" | python3 "$HEALTH")"
expect health "$OUT" "units active active active"
expect health "$OUT" "service=control-plane"
expect health "$OUT" "runtime=vm"
expect health "$OUT" "slots=2"
expect health "$OUT" "service=llm-gateway"
expect health "$OUT" "service=admin-api"
printf '%s\n' "$SAMPLE" | python3 "$HEALTH" >/dev/null
pass "health summarizer accepts a full probe"

if printf '%s\n' "active" "---" '{"ok":true,"service":"admin-api"}' | python3 "$HEALTH" >/dev/null; then
  fail "partial health should fail"
fi
pass "health summarizer rejects a partial probe"

OUT="$(bash "$ROOT/.cursor/skills/tencent-lighthouse-deploy/deploy.sh" --dry-run --from-rev HEAD)"
expect same-rev "$OUT" "sync=none"
expect same-rev "$OUT" "dry-run: no files copied"
pass "deploy.sh --dry-run --from-rev HEAD is a no-op"

echo "all deploy-plan checks passed"
