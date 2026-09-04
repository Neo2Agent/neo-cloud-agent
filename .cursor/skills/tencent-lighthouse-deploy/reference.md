# 腾讯云轻量：首次部署与控制台

配合 [SKILL.md](SKILL.md)。这里是第一次上机、防火墙、TAT、Caddy 细节。

## 控制台

1. 打开 [Lighthouse 北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)。
2. 未登录会拦微信扫码；等用户扫完再继续，不要猜密码。扫码、DNSPod A 记录、绑 `neorun.cloud` 的完整步骤见 [../tencent-lighthouse-domain/SKILL.md](../tencent-lighthouse-domain/SKILL.md)。
3. 确认实例 `Halo建站-AFjg`（`lhins-b0l0d8b2`）运行中，公网 `62.234.211.200`。
4. **不要点重启、再次重装、绑定密钥。** 镜像已经是 Ubuntu 24.04 系统镜像。
5. MySQL / Redis **不在这台机上**。库机是另一账号的 `neo-mysql-redis`（`101.42.105.230`），见 [../tencent-lighthouse-db/SKILL.md](../tencent-lighthouse-db/SKILL.md)。

## 防火墙（轻量安全组，不是 ufw）

主机 `ufw` 是 inactive。放行在控制台「防火墙」：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH |
| 80 | Caddy → 对话页（对外用这个） |
| 443 | 以后上 TLS |
| 8080 / 8081 | 可选直连控制面 / 网关；平时不必对公网开 |
| 8082 | **不要放行。** `neo-loop` 只绑 `127.0.0.1`，Caddy 也不反代 |

## TAT 写入 SSH 公钥（首次）

控制台绑定密钥会重启，所以用 **自动化助手 TAT**「执行命令」：

```bash
install -d -m 700 /home/ubuntu/.ssh
# 把整行公钥追加进去，不要覆盖已有行
grep -qxF 'ssh-ed25519 AAAA... neo-cloud-agent-deploy' /home/ubuntu/.ssh/authorized_keys \
  || echo 'ssh-ed25519 AAAA... neo-cloud-agent-deploy' >> /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

本机（操作者电脑，不是轻量）：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/neo_lighthouse -C neo-cloud-agent-deploy -N ""
# 把 ~/.ssh/neo_lighthouse.pub 填进上面的 TAT
# 私钥文件做单行 base64，放进 Cursor 环境 Runtime Secret：NEO_LIGHTHOUSE_SSH_KEY_B64
base64 -w0 ~/.ssh/neo_lighthouse; echo
```

Cloud Agent 开机后跑 [bootstrap-agent-access.sh](bootstrap-agent-access.sh)，会把 `NEO_LIGHTHOUSE_SSH_KEY_B64` 解码写成 `~/.ssh/neo_lighthouse` 并补上 `Host lighthouse`。不要把私钥提交或打进聊天。云 API 另配子用户 SecretId / SecretKey（地域 `ap-beijing`）。

## 软件

```bash
# Node 22.19+；这台已是 v22.23.1
node -v
corepack enable
corepack prepare pnpm@10.33.3 --activate
sudo apt-get update
sudo apt-get install -y e2fsprogs iproute2 iptables caddy
```

不要为了跑 Docker / Firecracker 去装一整套虚拟化。轻量没有 `/dev/kvm`。

Java 21 **先不装**。只有以后要 `systemctl enable --now neo-loop` 时才：

```bash
sudo apt-get install -y openjdk-21-jre-headless
java -version
```

## 代码与依赖

GitHub 通：

```bash
git clone https://github.com/Neo2Agent/neo-cloud-agent.git /home/ubuntu/neo-cloud-agent
cd /home/ubuntu/neo-cloud-agent
git checkout <branch>
pnpm install
```

不通：从能访问 GitHub 的机器 tar 过来（见 SKILL「日常更新 B」），再 `pnpm install`。

## `.env`

```bash
cp .env.example .env
chmod 600 .env
```

4C/4G 必改（值可以脚本写入，不要把整个 `.env` 打印出来）：

```
WORKER_RUNTIME=vm
VM_SLOT_COUNT=2
WORKER_CPUS=1
WORKER_MEMORY_MIB=512
WORKER_DISK_GIB=4
WARM_POOL_SIZE=0
LLM_UPSTREAM=mock
DEFAULT_MODEL=neo/deepseek
ACCOUNTS_REQUIRED=1
DEFAULT_ADMIN=1
```

`LLM_GATEWAY_JWT_SECRET` 在主机上生成一次，两边 unit 共用，不要提交。

现网写 `AGENT_KERNEL=agentscope` 和 `NEO_LOOP_URL=http://127.0.0.1:8082`。控制面默认就是 `agentscope`。不要把 `:8082` 写进 Caddy。

要落 MySQL / Redis 时，在这台机的 `.env` 加 `DATABASE_URL` / `REDIS_URL`（值从库机 `/home/ubuntu/db/.env` 拼，不要打印）。改完重启 `neo-control-plane`。

API Key **不要**写进 `.env` 也可以：上线后在对话页保存，落到 `.neo/llm-upstream.env`。

## systemd

模板：[units/neo-llm-gateway.service](units/neo-llm-gateway.service)、[units/neo-control-plane.service](units/neo-control-plane.service)、[units/neo-admin-api.service](units/neo-admin-api.service)、[units/neo-loop.service](units/neo-loop.service)（必开）。

```bash
sudo cp infra-or-skill-units/neo-llm-gateway.service /etc/systemd/system/
sudo cp infra-or-skill-units/neo-control-plane.service /etc/systemd/system/
sudo cp infra-or-skill-units/neo-admin-api.service /etc/systemd/system/
sudo cp infra-or-skill-units/neo-loop.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neo-llm-gateway neo-control-plane neo-admin-api neo-loop
```

仓库里的副本也在本 skill 的 `units/`。`WorkingDirectory` 必须是仓库根，`EnvironmentFile` 指向根目录 `.env`。控制面 `ExecStart` 必须是 `node --import tsx packages/control-plane/src/index.ts`，不要用 `pnpm --filter … start`：否则 MainPID 是 pnpm，`KillMode=process` 停不掉真正听 `:8080` 的进程。

控制面 `KillMode=process`：只杀控制面主进程，不杀它 spawn 的 worker。重启后 `adopt()` 按 pid 认领。`systemctl stop` 会留下在跑的 worker，下次启动收回。若 unit 停不住，看 `journalctl`，不要重启整机。

## Caddy

备份原文件再改：

```bash
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M)
sudo cp units/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

必须 `flush_interval -1`，否则对话 SSE 会缓冲。现网 Caddy 听 80 + 443，对外用 `https://neorun.cloud/` 对话、`https://neorun.cloud/admin/` 管理台（域名 HTTP 308 到 HTTPS），不要让用户去记 `:8080` / `:8090`。8090 只听本机。**不要**反代 `neo-loop` 的 `:8082`。不要用轻量控制台一键 HTTPS（只支持应用镜像）。现网文件就是 [../tencent-lighthouse-domain/units/Caddyfile.https](../tencent-lighthouse-domain/units/Caddyfile.https)。

## 系统镜像

2026-08-22 已用控制台 **重装系统**（勾选备份后重装）换成 **Ubuntu Server 24.04 LTS 64bit 系统镜像**，不再是爱马仕/Halo 应用模板。公网 IP 仍是 `62.234.211.200`。

- 登录用户 `ubuntu`；部署公钥注释 `neo-cloud-agent-deploy`
- 不要再选应用模板重装
- 装软件：Node 22、pnpm 10、`apt install caddy e2fsprogs`；不要装 Docker / 爱马仕
- 日常发版用 [deploy.sh](deploy.sh)，不要手搓全量 tar。覆盖源码后对话页必须有 `packages/web/dist`，管理台必须有 `packages/admin-web/dist`

## 验收命令

```bash
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1:8081/health
curl -sS http://127.0.0.1:8080/v1/vms
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/
```

浏览器：https://neorun.cloud/ → 登录 → 保存 DeepSeek/OpenAI Key → 新开对话。旧 mock 气泡不会改写。麦克风走同一 HTTPS 域名，讯飞密钥只放应用机 `.env`。
