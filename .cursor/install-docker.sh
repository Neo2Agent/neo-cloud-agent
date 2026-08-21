#!/usr/bin/env bash
# Idempotent Docker CE install for Cursor Cloud Agents (Ubuntu 24.04).
# Packages go on disk here; the daemon is started by start-docker.sh.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef)

sudo apt-get update
sudo apt-get "${APT_OPTS[@]}" --no-install-recommends install \
  ca-certificates curl gnupg iptables fuse-overlayfs

sudo install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
fi

codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update

# Prefer the version verified in this environment; fall back to current stable.
pin="5:29.7.2-1~ubuntu.24.04~noble"
if apt-cache madison docker-ce | grep -Fq "${pin}"; then
  sudo apt-get "${APT_OPTS[@]}" install \
    "docker-ce=${pin}" \
    "docker-ce-cli=${pin}" \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
else
  sudo apt-get "${APT_OPTS[@]}" install \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' \
    | sudo tee /etc/docker/daemon.json >/dev/null
fi

sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

sudo groupadd -f docker
if id -u ubuntu >/dev/null 2>&1; then
  sudo usermod -aG docker ubuntu
fi
