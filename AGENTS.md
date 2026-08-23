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

### Services (started by `pnpm dev`)
- `control-plane` on `:8080` — API + orchestration + SCM + events, and serves the web chat UI at `http://localhost:8080`.
- Desk client is Electron (`pnpm --filter @neo-cloud-agent/desk start`) after `pnpm build:web`. It loads `packages/web/dist` via `neo-desk://` and talks to the control plane. Browser preview on `:8082` (`pnpm dev:desk`) is only a fallback when there is no desktop session.
- `llm-gateway` on `:8081` — holds provider keys. With no `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` set it runs `upstream=mock`, which is enough to exercise runs end-to-end.
- Default `WORKER_RUNTIME=local`: `POST /v1/runs` spawns an in-process worker (no Docker needed). `docker`/`firecracker` runtimes need extra assets (see `README.md`).

### Testing
- `pnpm typecheck` and `pnpm test` (unit + in-process mock e2e, including `packages/cli`) are the reliable checks.
- `pnpm test:e2e` needs an already-running control-plane on `:8080`. Prefer `pnpm test` or `pnpm neo` against that server.
- Production-shaped hosts use `WORKER_RUNTIME=vm` (loop slots, no Docker/KVM). Idle slots persist the workspace then unmount after `WORKER_IDLE_RELEASE_MS`.

### Env
- The repo root `.env` (gitignored) is auto-loaded by both control-plane and gateway; existing environment variables take precedence. See `.env.example` for all keys.

### Web UI testing note
- The chat UI at `http://localhost:8080` is a React app. Login is required: type `admin` / `123456` (the form is empty and cannot be skipped). Prefer the API (`POST /v1/runs`) for scripted checks; `pnpm neo` is the terminal client against the same `/v1`.
