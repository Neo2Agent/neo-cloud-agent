import { spawn } from "node:child_process";
import path from "node:path";
import { ensureBackend, repoRoot } from "./ensure-backend.ts";

await ensureBackend();
console.log("web UI on http://127.0.0.1:5173 (control-plane API stays :8080)");
const child = spawn("pnpm", ["--filter", "@neo-cloud-agent/web", "dev"], {
  cwd: repoRoot(),
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
void path;
