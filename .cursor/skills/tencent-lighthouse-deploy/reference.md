# 腾讯云轻量：首次部署与控制台

配合 [SKILL.md](SKILL.md)。这里是第一次上机、防火墙、TAT、Caddy 细节。

## 控制台

1. 打开 [Lighthouse 北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)。
2. 未登录会拦微信扫码；等用户扫完再继续，不要猜密码。
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

本机：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/neo_lighthouse -C neo-cloud-agent-deploy -N ""
# 把 ~/.ssh/neo_lighthouse.pub 填进上面的 TAT
```

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

要落 MySQL / Redis 时，在这台机的 `.env` 加 `DATABASE_URL` / `REDIS_URL`（值从库机 `/home/ubuntu/db/.env` 拼，不要打印）。改完重启 `neo-control-plane`。

API Key **不要**写进 `.env` 也可以：上线后在对话页保存，落到 `.neo/llm-upstream.env`。

## systemd

模板：[units/neo-llm-gateway.service](units/neo-llm-gateway.service)、[units/neo-control-plane.service](units/neo-control-plane.service)。

```bash
sudo cp infra-or-skill-units/neo-llm-gateway.service /etc/systemd/system/
sudo cp infra-or-skill-units/neo-control-plane.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neo-llm-gateway neo-control-plane
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

必须 `flush_interval -1`，否则对话 SSE 会缓冲。对外只开 80 即可，不要让用户去记 `:8080`。

## 系统镜像

2026-08-22 已用控制台 **重装系统**（勾选备份后重装）换成 **Ubuntu Server 24.04 LTS 64bit 系统镜像**，不再是爱马仕/Halo 应用模板。公网 IP 仍是 `62.234.211.200`。

- 登录用户 `ubuntu`；部署公钥注释 `neo-cloud-agent-deploy`
- 不要再选应用模板重装
- 装软件：Node 22、pnpm 10、`apt install caddy e2fsprogs`；不要装 Docker / 爱马仕
- 覆盖源码后必须 `pnpm --filter @neo-cloud-agent/web build`，控制面只跑得起来 `packages/web/dist`

## 验收命令

```bash
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1:8081/health
curl -sS http://127.0.0.1:8080/v1/vms
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/
```

浏览器：http://62.234.211.200/ → 登录 → 保存 DeepSeek/OpenAI Key → 新开对话。旧 mock 气泡不会改写。
