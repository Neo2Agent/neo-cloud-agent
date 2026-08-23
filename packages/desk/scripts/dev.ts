import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DESK_UI_PORT } from "../src/ports.ts";
import { ensureBackend, repoRoot, waitForHttp } from "../../../scripts/ensure-backend.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const uiPort = Number(process.env.NEO_DESK_UI_PORT || DEFAULT_DESK_UI_PORT);
const uiUrl = `http://127.0.0.1:${uiPort}`;

await ensureBackend();

const vite = spawn("pnpm", ["exec", "vite", "--config", "ui/vite.config.ts"], {
  cwd: deskRoot,
  stdio: "inherit",
  env: { ...process.env, NEO_DESK_UI_PORT: String(uiPort) },
});
await waitForHttp(uiUrl);
console.log(`desk UI vite on ${uiUrl}; opening Electron (not a browser tab)`);

const electron = spawn("pnpm", ["exec", "electron", "app/main.cjs"], {
  cwd: deskRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    NEO_DESK_URL: uiUrl,
    NEO_CONTROL_PLANE_URL: process.env.NEO_CONTROL_PLANE_URL || "http://127.0.0.1:8080",
    DISPLAY: process.env.DISPLAY || ":1",
  },
});

const stop = () => {
  electron.kill("SIGTERM");
  vite.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  vite.kill("SIGTERM");
  process.exit(code ?? 0);
});
void repoRoot;
