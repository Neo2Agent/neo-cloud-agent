/**
 * Serves the control-plane (and built web UI) on :18080 for Playwright.
 * Isolated RUNS_DIR; default admin is admin / 123456.
 */
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const port = Number(process.env.E2E_UI_PORT ?? 18080);

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.AGENT_KERNEL = "pi";
process.env.LLM_UPSTREAM = "mock";
process.env.LLM_GATEWAY_JWT_SECRET = process.env.LLM_GATEWAY_JWT_SECRET || "core-e2e-ui-secret";
process.env.ACCOUNTS_REQUIRED = "1";
process.env.DEFAULT_ADMIN = "1";
process.env.RATE_LIMIT = "0";
process.env.BUILD_CAPTURE = "0";
process.env.OBJECT_STORE = "memory";
process.env.CONTROL_PLANE_PORT = String(port);
process.env.RUNS_DIR = process.env.CORE_E2E_RUNS_DIR ?? mkdtempSync(path.join(tmpdir(), "neo-core-e2e-ui-"));
process.env.HOST_RUNS_DIR = process.env.RUNS_DIR;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.MEM0_URL;
delete process.env.MEM0_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;

const webIndex = path.join(repoRoot, "packages/web/dist/index.html");
if (!existsSync(webIndex)) {
  console.error("packages/web/dist/index.html missing. Run: pnpm build:web");
  process.exit(2);
}

const { createApiServer } = await import("../../../packages/control-plane/src/api/server.js");
const { ensureDefaultAdmin } = await import("../../../packages/control-plane/src/accounts/accounts.js");

const server = createApiServer();
await new Promise<void>((resolve, reject) => {
  server.listen(port, "127.0.0.1", () => resolve());
  server.on("error", reject);
});
await ensureDefaultAdmin();
console.log(`core-e2e ui server http://127.0.0.1:${port} runsDir=${process.env.RUNS_DIR}`);
