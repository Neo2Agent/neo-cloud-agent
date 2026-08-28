import { ensureBackend, repoRoot } from "./ensure-backend.ts";
import { spawnPnpm, killSpawned } from "./spawn-pnpm.ts";

async function main(): Promise<void> {
  await ensureBackend();
  console.log("web UI on http://127.0.0.1:5173 (control-plane API stays :8080)");
  const child = spawnPnpm(["--filter", "@neo-cloud-agent/web", "dev"], {
    cwd: repoRoot(),
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => killSpawned(child, "SIGINT"));
  process.on("SIGTERM", () => killSpawned(child, "SIGTERM"));
}

void main();
