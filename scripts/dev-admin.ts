import { repoRoot } from "./ensure-backend.ts";
import { spawnPnpm, killSpawned } from "./spawn-pnpm.ts";

function run(filter: string): void {
  const child = spawnPnpm(["--filter", filter, "dev"], {
    cwd: repoRoot(),
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code) process.exit(code);
  });
  process.on("SIGINT", () => killSpawned(child, "SIGINT"));
  process.on("SIGTERM", () => killSpawned(child, "SIGTERM"));
}

console.log("admin-api :8090  admin-web :5176  (does not start the chat UI or control-plane)");
run("@neo-cloud-agent/admin-api");
run("@neo-cloud-agent/admin-web");
