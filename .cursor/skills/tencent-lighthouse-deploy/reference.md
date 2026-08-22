# 腾讯云轻量：首次部署与控制台

配合 [SKILL.md](SKILL.md)。这里是第一次上机、防火墙、TAT、Caddy 细节。

## 控制台

1. 打开 [Lighthouse 北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)。
2. 未登录会拦 Hermes 扫码；等用户扫完再继续，不要猜密码。
3. 确认实例 `Halo建站-AFjg`（`lhins-b0l0d8b2`）运行中，公网 `62.234.211.200`。
4. **不要点重启、重装、绑定密钥。**

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
ACCOUNTS_REQUIRED=0
DEFAULT_ADMIN=1
```

`LLM_GATEWAY_JWT_SECRET` 在主机上生成一次，两边 unit 共用，不要提交。

线上还要有（值从新库机 `/home/ubuntu/db/.env` 拼，不要打印）：

```
DATABASE_URL=mysql://app:…@101.42.105.230:3306/app
REDIS_URL=redis://:…@101.42.105.230:6379/0
```

API Key **不要**写进 `.env` 也可以：上线后在对话页保存，落到 `.neo/llm-upstream.env`。

## systemd

模板：[units/neo-llm-gateway.service](units/neo-llm-gateway.service)、[units/neo-control-plane.service](units/neo-control-plane.service)。

```bash
sudo cp infra-or-skill-units/neo-llm-gateway.service /etc/systemd/system/
sudo cp infra-or-skill-units/neo-control-plane.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neo-llm-gateway neo-control-plane
```

仓库里的副本也在本 skill 的 `units/`。`WorkingDirectory` 必须是仓库根，`EnvironmentFile` 指向根目录 `.env`。

控制面 `KillMode=control-group`：重启时要杀掉它拉起的本地 worker。若 unit 停不住，看 `journalctl`，不要重启整机。

## Caddy

备份原文件再改：

```bash
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M)
sudo cp units/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

必须 `flush_interval -1`，否则对话 SSE 会缓冲。对外只开 80 即可，不要让用户去记 `:8080`。

## 爱马仕

旧网关是用户 systemd：`hermes-gateway.service`，`Restart=always`，linger=yes。已 `stop/disable`，单元文件改名为 `hermes-gateway.service.disabled`。

- 不要 `systemctl --user start hermes-gateway`
- 不要读 `~/.hermes/.env`
- 数据目录 `~/.hermes` 可以留着

## 验收命令

```bash
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1:8081/health
curl -sS http://127.0.0.1:8080/v1/vms
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/
```

浏览器：http://62.234.211.200/ → 登录 → 保存 DeepSeek/OpenAI Key → 新开对话。旧 mock 气泡不会改写。
