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
- `llm-gateway` on `:8081` — holds provider keys. With no `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` set it runs `upstream=mock`, which is enough to exercise runs end-to-end.
- Default `WORKER_RUNTIME=local`: `POST /v1/runs` spawns an in-process worker (no Docker needed). `docker`/`firecracker` runtimes need extra assets (see `README.md`).

### Testing
- `pnpm typecheck` and `pnpm test` (unit + in-process mock e2e) are the reliable checks; both pass on a clean setup.
- `pnpm test:e2e` (the standalone HTTP script `scripts/e2e-http.ts`) currently fails to launch because it uses top-level `await` but the repo root has no `"type": "module"`, so tsx transforms it as CJS. To verify the HTTP path, either run `pnpm test` or drive the running server directly (`curl` `/health`, `POST /v1/runs`, poll `/v1/runs/:id` and `/v1/runs/:id/transcript` until `status=IDLE`).

### Env
- The repo root `.env` (gitignored) is auto-loaded by both control-plane and gateway; existing environment variables take precedence. See `.env.example` for all keys.

### Web UI testing note
- The chat UI at `http://localhost:8080` currently shows a login/register modal (`#auth-gate`) on load and does not auto-dismiss after a successful login, even though accounts are not required (`authRequired=false`). For scripted/manual checks prefer driving the API directly (`POST /v1/runs`); if testing the UI, expect to dismiss/log in past that modal.
