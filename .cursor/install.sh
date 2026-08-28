#!/usr/bin/env bash
# Idempotent development-environment install for neo-cloud-agent Cloud Agents.
# Prepares Docker CE, the pinned Node toolchain (via nvm + .nvmrc), the pnpm
# workspace, and a production web bundle. Safe to run repeatedly against cached
# or partially prepared state. Long-running services live in `start`/`terminals`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# 1. Docker CE — packages land on disk here; the daemon is started by
#    start-docker.sh on every boot. Enables build:worker-image / test:docker.
bash "${SCRIPT_DIR}/install-docker.sh"

# 2. Node toolchain pinned by .nvmrc, installed through nvm. The default
#    /exec-daemon node is older than this repo's engines requirement, so the
#    nvm-managed version is authoritative.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  echo "install: nvm missing at ${NVM_DIR}; bootstrapping nvm" >&2
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm install
nvm use
corepack enable

# 3. Workspace dependencies, frozen to the committed lockfile.
pnpm install --frozen-lockfile

# 4. Production web bundle so control-plane :8080 serves the chat UI even when
#    the Vite dev server is not running.
pnpm build:web

echo "install: node $(node -v), pnpm $(pnpm -v); workspace ready"
