#!/usr/bin/env bash
# Classify a list of changed repo paths into lighthouse deploy actions.
# Reads paths from stdin (one per line) or extra args. Prints KEY=0|1 lines.
# Does not SSH, read secrets, or print file contents.
set -euo pipefail

sync="incremental"
install=0
build_web=0
build_admin=0
restart_gateway=0
restart_control_plane=0
restart_admin_api=0
update_units=0

usage() {
  cat <<'EOF'
Usage: deploy-plan.sh [--full] [path ...]
       git diff --name-only FROM TO | deploy-plan.sh

Prints:
  sync=none|incremental|full
  install=0|1
  build_web=0|1
  build_admin=0|1
  restart_gateway=0|1
  restart_control_plane=0|1
  restart_admin_api=0|1
  update_units=0|1
EOF
}

skip_path() {
  local p="${1#./}"
  case "$p" in
    .env|.env.*|.neo|.neo/*|node_modules|*/node_modules|*/node_modules/*|.git|.git/*|dist|*/dist|*/dist/*|.deploy-revision)
      return 0
      ;;
  esac
  return 1
}

mark() {
  case "$1" in
    install) install=1 ;;
    build_web) build_web=1 ;;
    build_admin) build_admin=1 ;;
    restart_gateway) restart_gateway=1 ;;
    restart_control_plane) restart_control_plane=1 ;;
    restart_admin_api) restart_admin_api=1 ;;
    update_units) update_units=1 ;;
  esac
}

classify() {
  local p="${1#./}"
  p="${p%$'\r'}"
  [[ -z "$p" ]] && return 0
  skip_path "$p" && return 0

  case "$p" in
    pnpm-lock.yaml|pnpm-workspace.yaml|package.json|.npmrc)
      mark install
      return 0
      ;;
    packages/*/package.json)
      mark install
      ;;
  esac

  case "$p" in
    packages/contracts/*|packages/contracts)
      mark build_web
      mark build_admin
      mark restart_gateway
      mark restart_control_plane
      mark restart_admin_api
      return 0
      ;;
    packages/web/*|packages/web)
      mark build_web
      return 0
      ;;
    packages/admin-web/*|packages/admin-web)
      mark build_admin
      return 0
      ;;
    packages/llm-gateway/*|packages/llm-gateway)
      mark restart_gateway
      return 0
      ;;
    packages/control-plane/*|packages/control-plane|packages/worker/*|packages/worker|packages/extensions/*|packages/extensions|tsconfig.json|tsconfig.base.json)
      mark restart_control_plane
      return 0
      ;;
    packages/admin-api/*|packages/admin-api)
      mark restart_admin_api
      return 0
      ;;
    .cursor/skills/tencent-lighthouse-deploy/units/*.service)
      mark update_units
      case "$p" in
        */neo-llm-gateway.service) mark restart_gateway ;;
        */neo-control-plane.service) mark restart_control_plane ;;
        */neo-admin-api.service) mark restart_admin_api ;;
      esac
      return 0
      ;;
  esac
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--full" ]]; then
  sync="full"
  install=1
  build_web=1
  build_admin=1
  restart_gateway=1
  restart_control_plane=1
  restart_admin_api=1
  update_units=1
  shift
fi

paths=0
while [[ $# -gt 0 ]]; do
  classify "$1"
  paths=$((paths + 1))
  shift
done

if [[ ! -t 0 ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    classify "$line"
    paths=$((paths + 1))
  done
fi

if [[ "$sync" != "full" && "$paths" -eq 0 ]]; then
  sync="none"
fi

if [[ "$sync" != "full" && "$install$build_web$build_admin$restart_gateway$restart_control_plane$restart_admin_api$update_units" == "0000000" && "$paths" -gt 0 ]]; then
  # Docs/tests/desk/mobile still copy, but nothing has to run on the host.
  :
fi

printf 'sync=%s\n' "$sync"
printf 'install=%s\n' "$install"
printf 'build_web=%s\n' "$build_web"
printf 'build_admin=%s\n' "$build_admin"
printf 'restart_gateway=%s\n' "$restart_gateway"
printf 'restart_control_plane=%s\n' "$restart_control_plane"
printf 'restart_admin_api=%s\n' "$restart_admin_api"
printf 'update_units=%s\n' "$update_units"
