# Core E2E（边界 + computer-use）

覆盖 [`docs/core-features.md`](../docs/core-features.md) 里的 8 个核心能力。两层：

1. **API 边界**（`e2e/core/api/*.test.ts`）— 进程内拉起 control-plane，不需要浏览器、模型 key、讯飞 key。
2. **UI 边界**（Playwright，`e2e/core/ui/*.spec.ts`）— 打对话页 DOM。默认自己起 `:18080`（托管已构建的 `packages/web/dist`）。
3. **Computer-use 清单** — [`checklist.yaml`](./checklist.yaml)，给外部 UI/computer-use agent 按步点现网或本地。

已有的 `pnpm test:e2e`（`scripts/e2e-http.ts`）仍是「对已运行的 `:8080` 打一条 mock turn」。本目录不替代它。

## URL

| 环境 | 对话页 | API / health |
| --- | --- | --- |
| 本地 Vite | `http://127.0.0.1:5173` | `http://127.0.0.1:8080`（Vite 把 `/v1` `/health` 代理过去） |
| 本地托管构建 | `http://127.0.0.1:8080` | 同上 |
| Playwright 夹具 | `http://127.0.0.1:18080` | 同上端口 |
| 现网 | `https://neorun.cloud/` | 同源 `/v1`、`/health` |
| 现网管理台（非核心） | `https://neorun.cloud/admin/` | `:8090` |

默认账号：`admin` / `123456`。表单不预填。

## 怎么起被测应用

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"   # Cloud Agent 环境必须
pnpm install
pnpm dev          # control-plane :8080 + llm-gateway :8081
pnpm dev:web      # 对话页 :5173，复用已有 :8080
```

只要 API、不要热更新：

```bash
pnpm build:web
pnpm dev          # 打开 http://127.0.0.1:8080
```

Gateway 无 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 时 `upstream=mock`。现网语音必须走 HTTPS；讯飞三件套只放服务器 `.env`。

## 怎么跑测试

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"

# API 边界（CI 跑这个；不需要浏览器）
pnpm test:e2e:core

# UI 边界（需要已构建 web + Chromium）
pnpm build:web
pnpm exec playwright install chromium   # 第一次
pnpm test:e2e:ui
```

| 变量 | 作用 |
| --- | --- |
| `E2E_WEB_URL` / `WEB_BASE_URL` | Playwright 打这个对话页，不再起 `:18080` |
| `E2E_EMAIL` / `E2E_PASSWORD` | UI 登录（默认 `admin` / `123456`） |
| `E2E_UI_PORT` | 本地夹具端口（默认 `18080`） |
| `IFLYTEK_APP_ID` + `IFLYTEK_API_KEY` + `IFLYTEK_API_SECRET` | 未齐则听写「已配置」和 live 转写用例 skip |
| `E2E_BASE_URL` | 旧的 `pnpm test:e2e` HTTP 脚本，默认 `http://127.0.0.1:8080` |

对现网跑 UI（会写真实账号的对话，小心）：

```bash
E2E_WEB_URL=https://neorun.cloud E2E_EMAIL=admin E2E_PASSWORD=... pnpm test:e2e:ui
```

缺 Chromium 时 `pnpm test:e2e:ui` 会失败并提示 `playwright install`。不要把 UI 套件并进默认 `pnpm test`。

## Computer-use

把 [`checklist.yaml`](./checklist.yaml) 交给外部 agent。它带：

- `urls` / `auth` / `env`
- 每个 `id` 对应核心功能的一步步 `steps`（选择器、要输入的字、要点的按钮）
- `expected` 与 `fail`
- `skipWhen`（缺密钥、非 HTTPS 等）

`id` 与 `docs/core-features.md` 末表、API/UI 测试名对齐。

## 用例怎么命名

`领域.边界`，例如 `auth.wrong-password`、`term.too-long`、`speech.not-configured`。
断言的是用户或客户端能看见的 HTTP 状态 / DOM 文案，不测内部函数。
