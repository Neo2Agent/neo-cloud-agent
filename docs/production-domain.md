# 现网域名

生产对话页除了 IP，还可以用 `neorun.cloud`。操作清单在 [.cursor/skills/tencent-lighthouse-domain/SKILL.md](../.cursor/skills/tencent-lighthouse-domain/SKILL.md)。部署与 Caddy 默认配置见 [.cursor/skills/tencent-lighthouse-deploy/SKILL.md](../.cursor/skills/tencent-lighthouse-deploy/SKILL.md)。

## 现状（2026-08-31）

| 项 | 值 |
| --- | --- |
| 域名 | `neorun.cloud`（腾讯云新注 1 年） |
| 账号 | 周栋 / UIN `100046045274` |
| 解析 | `@`、`www` → A `62.234.211.200`（DNSPod，TTL 600） |
| 应用机 | `Halo建站-AFjg` / `lhins-b0l0d8b2`，北京六区 |
| HTTP | **主入口（备案期间）**。`http://neorun.cloud` / `http://www.neorun.cloud` / `http://62.234.211.200/` 都直接反代，**不** 308 到 HTTPS |
| HTTPS | 证书继续续（Let's Encrypt）。备案未过时国内 443 常被重置，所以不跳 HTTPS、不下 HSTS。备案过了再改回跳转 |

Caddy 用 [Caddyfile.https](../.cursor/skills/tencent-lighthouse-domain/units/Caddyfile.https)：`auto_https disable_redirects`，域名和 IP 的 HTTP 都听 `:80`。`/` 反代 `127.0.0.1:8080`（对话），`/admin/` 反代 `127.0.0.1:8090`（管理台，`handle_path` 去掉 `/admin`）。`flush_interval -1`。不要用 `https://neorun.cloud/a` 这种无意义路径，也不要再买第二个域名。DNS 里如果已经有 `admin` A 记录，Caddy 把 `admin.neorun.cloud` 308 到 `http://neorun.cloud/admin/`。入口层要不要换成 Nginx：不要。理由和以后真换时的对齐清单见 [nginx-research.md](./nginx-research.md)。

## 怎么绑（摘要）

1. 用**买域名的微信**扫码登录腾讯云（未登录会拦；不要猜密码）。
2. 确认账号能同时看到 `neorun.cloud` 和实例 `62.234.211.200`。库机账号 `100047610252` 看不到这两样。
3. 在 DNSPod 加/改 A 记录：`@` 与 `www` → `62.234.211.200`。
4. 可选：轻量实例「域名解析」里再挂一次同一条记录，状态应为「正常」。
5. 防火墙保留 80 / 443 / 22。不要把域名指到库机 `101.42.105.230`。
6. 不要重启实例，不要控制台「绑定密钥」。

```bash
dig +short A neorun.cloud @1.1.1.1
curl -sS -o /dev/null -w "%{http_code}\n" --resolve neorun.cloud:80:62.234.211.200 http://neorun.cloud/
```

期望 `62.234.211.200` 和 HTTP `200`（不要 308 到 HTTPS），对话页标题 `Neo Cloud Agent`，`http://neorun.cloud/admin/` 标题 `Neo 管理台`。

## HTTPS 要不要花钱

**现网这套要上 `https://neorun.cloud`，不必花钱。**

证书本身和 443 端口都不是轻量套餐外的必付项。现网防火墙 443 已经开着。花钱的只有「去腾讯云买一张付费品牌证书」或「用 EdgeOne / CDN 套一层」，现网用不上。

| 做法 | 钱 | 和现网的关系 | 建议 |
| --- | --- | --- | --- |
| **Caddy + Let's Encrypt** | **0 元**，约 90 天一张，Caddy 自动续 | **现网已用这个。** 模板：[Caddyfile.https](../.cursor/skills/tencent-lighthouse-domain/units/Caddyfile.https) | 保持即可。证书坏了先看 `journalctl -u caddy`，不要买付费证书 |
| 腾讯云免费 DV（TrustAsia） | **0 元** | 每账号最多 50 张；有效期 **90 天**；不能续费，要重新申请；单域名，不含泛域名。见 [免费 SSL 概述](https://cloud.tencent.com/document/product/400/89868) | 能用，但要每季度重签，还得手动塞进 Caddy |
| 轻量控制台「设置 HTTPS」 | 证书可以免费 | **只支持** WordPress / LAMP / Typecho 等**应用镜像**，靠 TAT 改 Nginx。[官方说明](https://cloud.tencent.com/document/product/1207/84359)。北京地域还不能「在线申请」；在线申请仅香港及境外 | **不要点。** 现网是 Ubuntu 24.04 **系统镜像** + Caddy，一点会和现栈冲突 |
| 腾讯云付费 DV | 约 **318～560 元/年** 起（WoTrus 318、Rapid 405、DNSPod 560；[价格总览](https://cloud.tencent.com/document/product/400/7994)，2026-01 文档） | 品牌证书、控制台托管；泛域名更贵（DNSPod DV 通配符 2260 元/年） | 只有要发票、OV/EV、或官方托管时才买 |

Let's Encrypt / Caddy 自动 HTTPS 也不收腾讯云的钱。现网 2026-08-25 已按此签发。证书坏了先查解析、443、以及 `journalctl -u caddy` 里有没有 `certificate obtained successfully`，不要先去买证书。

付费证书 2026-01-01 起 Rapid / GeoTrust / SecureSite 又调过价（[公告](https://cloud.tencent.com/announce/detail/2176)）。下单以购买页为准。

## 以后改 Caddy / 换证书

1. 确认 `dig +short A neorun.cloud @1.1.1.1` 仍是 `62.234.211.200`，443 已放行。
2. SSH 到应用机（TAT 写公钥，不要控制台绑密钥）。
3. 备份 `/etc/caddy/Caddyfile`，改完 `sudo caddy validate` 再 `sudo systemctl reload caddy`。
4. 验 `https://neorun.cloud/` 为 200。
5. 不要重装系统，不要让 TAT 按应用镜像装 Nginx。
