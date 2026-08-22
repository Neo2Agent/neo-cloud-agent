# 库机：首次部署

配合 [SKILL.md](SKILL.md)。这台是 **另一个腾讯云账号** 上的轻量，不是 `Halo建站-AFjg`。

## 控制台

1. 用 UIN `100047610252` 登录。旧号 Chrome 会话看不到这台。
2. 打开 [Lighthouse 北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)（`rid=8`）。
3. 实例 `neo-mysql-redis`（`lhins-1whwkmau`）运行中，公网 `101.42.105.230`。
4. **不要点重启、绑定密钥。** 现网制品是 **Ubuntu 24.04 LTS 系统镜像**（`lhbp-1l4ptuvm`）。再重装会清盘，先备份 `/home/ubuntu/db`。`ResetInstance` 要账号微信 MFA。不要选 OpenClaw / Hermes。

未登录会被微信/Hermes 扫码拦住。Agent 浏览器登录和用户手机登录不是同一会话，不要猜密码。

## 防火墙（轻量安全组，不是 ufw）

主机 `ufw` 是 inactive。放行在控制台「防火墙」：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH |
| 3306 | MySQL（现网 `0.0.0.0/0`，只靠密码；能收到应用机出口 IP 就收窄） |
| 6379 | Redis（同上） |
| 20041 | 旧 OpenClaw 端口，可删 |
| ICMP | ping |

## TAT 写入 SSH 公钥（首次）

控制台绑定密钥会重启，所以用 **自动化助手 TAT**「执行命令」：

```bash
install -d -m 700 /home/ubuntu/.ssh
grep -qxF 'ssh-ed25519 AAAA... neo-db-deploy' /home/ubuntu/.ssh/authorized_keys \
  || echo 'ssh-ed25519 AAAA... neo-db-deploy' >> /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

本机：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/neo_lighthouse_new -C neo-db-deploy -N ""
# 把 ~/.ssh/neo_lighthouse_new.pub 填进上面的 TAT
```

## Docker

Docker Hub 直连常超时，装完立刻加腾讯云镜像：

`get.docker.com` / `download.docker.com` 常被 RST。用腾讯云 apt：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu
sudo mkdir -p /etc/docker
printf '%s\n' '{"registry-mirrors":["https://mirror.ccs.tencentyun.com"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl enable --now docker
sudo docker compose version
```

新会话才有 `docker` 组。当前 shell 用 `sudo docker`。

恢复 Redis 备份时：compose 开了 AOF，空 AOF 会盖掉 `dump.rdb`。先 `--appendonly no` 载入 RDB，再 `CONFIG SET appendonly yes` + `BGREWRITEAOF`，然后才 `compose up redis`。

## 目录与密钥

```bash
mkdir -p /home/ubuntu/db
# 在能访问本仓库的机器上把 skill 里的 docker-compose.yml 拷过去
# scp .cursor/skills/tencent-lighthouse-db/docker-compose.yml lighthouse-db:/home/ubuntu/db/

# 在库机上生成一次，不要回传到聊天
python3 - <<'PY'
import secrets, pathlib
p = pathlib.Path("/home/ubuntu/db/.env")
if p.exists():
    raise SystemExit(".env already exists")
def tok():
    return secrets.token_urlsafe(18)
p.write_text(
    "MYSQL_ROOT_PASSWORD=" + tok() + "\n"
    "MYSQL_DATABASE=app\n"
    "MYSQL_USER=app\n"
    "MYSQL_PASSWORD=" + tok() + "\n"
    "REDIS_PASSWORD=" + tok() + "\n"
)
p.chmod(0o600)
print("wrote", p, "keys only: MYSQL_ROOT_PASSWORD MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD REDIS_PASSWORD")
PY
```

## 拉起

```bash
cd /home/ubuntu/db
docker compose pull
docker compose up -d
docker compose ps
```

期望：`db-mysql`、`db-redis` 都是 `healthy`，监听 `0.0.0.0:3306` / `0.0.0.0:6379`。

控制面表由应用进程首次连接时创建，不要手写 schema。

## 接到应用机

在 **应用机** `/home/ubuntu/neo-cloud-agent/.env` 写入 `DATABASE_URL` / `REDIS_URL`（从库机 `.env` 拼，不要 `cat` 整个文件）。然后：

```bash
ssh lighthouse 'sudo systemctl restart neo-control-plane'
ssh lighthouse 'curl -sS http://127.0.0.1:8080/health; echo'
```

期望 JSON 里 `metadataStore` 为 `mysql`，`eventBus` 为 `redis`。
