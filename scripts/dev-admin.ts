import { spawn } from "node:child_process";
import { repoRoot } from "./ensure-backend.ts";

function run(filter: string): void {
  const child = spawn("pnpm", ["--filter", filter, "dev"], {
    cwd: repoRoot(),
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code) process.exit(code);
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

console.log("admin-api :8090  admin-web :5176  (does not start the chat UI or control-plane)");
run("@neo-cloud-agent/admin-api");
run("@neo-cloud-agent/admin-web");
