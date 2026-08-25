# neo-cloud-agent

Cloud agent service (control plane + LLM gateway + in-VM worker running pi-agent). A pnpm/TypeScript monorepo. See `README.md` and `docs/architecture.md` for the full design and command reference.

## Cursor Cloud specific instructions

### Node version (important gotcha — read before running any pnpm command)
- The default `node` on PATH is `/exec-daemon/node` (v22.14.0), which is **older than this repo's requirement** (`engines.node >=22.19`, `.nvmrc` pins `22.23.2`, `.npmrc` sets `engine-strict=true`). Running `pnpm` with it fails with `ERR_PNPM_UNSUPPORTED_ENGINE`.
- `/exec-daemon` is injected ahead of nvm in PATH even for login shells, and sourcing nvm does **not** auto-select the default node. So you must explicitly prepend the nvm bin in each interactive shell before running pnpm:
  ```bash
  export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
  ```
- The update script already installs the `.nvmrc` node (`22.23.2`) via nvm, so the path above exists after startup. `pnpm` then resolves to the pinned `pnpm@10.33.3` via corepack.

### Services
- `pnpm dev` — backend only: `control-plane` `:8080` + `llm-gateway` `:8081`.
- `pnpm dev:web` — Web UI on `:5173` (reuses backend on `:8080` if already up). This is `packages/web`.
- `pnpm dev:admin` — standalone admin console: `admin-api` `:8090` + `admin-web` `:5176`. Not the chat UI. Login is still `admin` / `123456` (or `ADMIN_EMAILS`). Production path is `https://neorun.cloud/admin/` (same host as chat, not `/a` `/b` and not a second domain).
- `pnpm dev:desk` — Desk UI Vite on `:5174` plus the Electron window, against local `:8080`. This is `packages/desk/ui`, a different UI that talks to the same `/v1`. Do not confuse with the old `:8082` browser preview (`pnpm preview:desk`).
- `pnpm dev:desk:prod` — same Desk window, API is the production control plane (`https://neorun.cloud` or `http://62.234.211.200` unless `NEO_CONTROL_PLANE_URL` is a non-loopback override). Does not start local `:8080`. Web against production is just opening that URL. Domain bind / HTTPS: `.cursor/skills/tencent-lighthouse-domain/SKILL.md` and `docs/production-domain.md`.
- `llm-gateway` holds provider keys. With no `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` set it runs `upstream=mock`, which is enough to exercise runs end-to-end.
- Default `WORKER_RUNTIME=local`: `POST /v1/runs` spawns an in-process worker (no Docker needed). `docker`/`firecracker` runtimes need extra assets (see `README.md`).

### Testing
- `pnpm typecheck` and `pnpm test` (unit + in-process mock e2e, including `packages/cli`) are the reliable checks.
- `pnpm test:e2e` needs an already-running control-plane on `:8080`. Prefer `pnpm test` or `pnpm neo` against that server.
- Production-shaped hosts use `WORKER_RUNTIME=vm` (loop slots, no Docker/KVM). Idle slots persist the workspace then unmount after `WORKER_IDLE_RELEASE_MS`.

### Tencent Lighthouse (production host)
- Operate the Beijing app host via `.cursor/skills/tencent-lighthouse-deploy/SKILL.md`. New Cloud Agent chats do **not** keep the previous `~/.ssh`.
- If Cursor environment Secrets are set, run `bash .cursor/skills/tencent-lighthouse-deploy/bootstrap-agent-access.sh` then `ssh lighthouse`. Never print the secret values.
- Runtime Secrets (environment [6f60409c-9d84-11f1-a7d1-d6b4613131ce](https://cursor.com/dashboard/cloud-agents/environments/e/6f60409c-9d84-11f1-a7d1-d6b4613131ce)): `NEO_LIGHTHOUSE_SSH_KEY_B64` (base64 of the operator-generated SSH **private** key file, not a Tencent console ID), plus Tencent Cloud API SecretId/SecretKey. Optional env var: `TENCENTCLOUD_REGION=ap-beijing`.
- Secrets added mid-run are invisible until a **new** Cloud Agent starts on that environment. Do not reboot the Lighthouse or console-bind SSH keys. ICP 备案 / WeChat login have no API.

### Env
- The repo root `.env` (gitignored) is auto-loaded by both control-plane and gateway; existing environment variables take precedence. See `.env.example` for all keys.

### Web UI testing note
- Web chat UI: `http://localhost:5173` via `pnpm dev:web` (control-plane still serves a copy at `:8080`). Login is `admin` / `123456` (the form is empty and cannot be skipped). Prefer the API (`POST /v1/runs`) for scripted checks; `pnpm neo` is the terminal client against the same `/v1`.
