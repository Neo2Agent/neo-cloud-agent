#!/usr/bin/env bash
# Idempotent development-environment install for neo-cloud-agent Cloud Agents.
# Prepares Docker CE, JDK 21 + Maven (neo-loop), the pinned Node toolchain
# (via nvm + .nvmrc), the pnpm workspace, and a production web bundle. Safe
# to run repeatedly against cached or partially prepared state. Long-running
# services live in `start`/`terminals`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# 1. Docker CE — packages land on disk here; the daemon is started by
#    start-docker.sh on every boot. Enables build:worker-image / test:docker.
bash "${SCRIPT_DIR}/install-docker.sh"

# 2. JDK 21 + Maven — required for `mvn -f services/neo-loop test`,
#    `pnpm test:loop`, and `deploy.sh` packing the optional neo-loop jar.
#    The image may already have OpenJDK 21; Maven is not on the default PATH.
if ! command -v javac >/dev/null 2>&1; then
  echo "install: OpenJDK 21 missing; installing openjdk-21-jdk-headless" >&2
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-21-jdk-headless
fi
if ! command -v mvn >/dev/null 2>&1; then
  echo "install: Maven missing; installing maven" >&2
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends maven
fi

# 3. Node toolchain pinned by .nvmrc, installed through nvm. The default
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

# 4. Workspace dependencies, frozen to the committed lockfile.
pnpm install --frozen-lockfile

# 5. Production web bundle so control-plane :8080 serves the chat UI even when
#    the Vite dev server is not running.
pnpm build:web

echo "install: node $(node -v), pnpm $(pnpm -v), java $(java -version 2>&1 | awk -F'\"' 'NR==1{print $2; exit}'), mvn $(mvn -v 2>/dev/null | awk '/Apache Maven/{print $3; exit}'); workspace ready"
