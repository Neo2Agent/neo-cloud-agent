import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDeskDevLaunch } from "../src/dev-launch.ts";
import { ensureBackend, waitForHttp } from "../../../scripts/ensure-backend.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function stop(child: ChildProcess | null | undefined): void {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

async function main(): Promise<void> {
  const launch = resolveDeskDevLaunch();
  const children: ChildProcess[] = [];
  let backend: ChildProcess | null = null;

  if (launch.startLocalBackend) {
    backend = await ensureBackend();
    if (backend) children.push(backend);
  } else {
    await waitForHttp(`${launch.apiBase}/health`);
  }

  console.log(
    `Desk ${launch.label} 完整服务：前端 ${launch.uiUrl} → 后端 ${launch.apiBase}${launch.startLocalBackend ? " （本机 control-plane :8080 + gateway :8081）" : ""}`,
  );

  const vite = spawn("pnpm", ["exec", "vite", "--config", "ui/vite.config.ts"], {
    cwd: deskRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEO_DESK_UI_PORT: String(launch.uiPort),
      NEO_CONTROL_PLANE_URL: launch.apiBase,
    },
  });
  children.push(vite);
  await waitForHttp(launch.uiUrl);

  const skipElectron = process.env.NEO_DESK_NO_ELECTRON === "1" || process.env.NEO_DESK_NO_ELECTRON === "true";
  let electron: ChildProcess | null = null;
  if (!skipElectron) {
    electron = spawn("pnpm", ["exec", "electron", "app/main.cjs"], {
      cwd: deskRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        NEO_DESK_URL: launch.uiUrl,
        NEO_CONTROL_PLANE_URL: launch.apiBase,
        DISPLAY: process.env.DISPLAY || ":1",
      },
    });
    electron.on("exit", (code) => {
      console.log(`electron exited (${code ?? "?"}); Desk ${launch.label} 仍在 ${launch.uiUrl}`);
    });
    electron.on("error", (error) => {
      console.log(`electron 未打开（${error.message}）；用浏览器打开 ${launch.uiUrl}`);
    });
  } else {
    console.log(`NEO_DESK_NO_ELECTRON=1，用浏览器打开 ${launch.uiUrl}`);
  }

  let closed = false;
  const shutdown = (code = 0) => {
    if (closed) return;
    closed = true;
    stop(electron);
    for (const child of children) stop(child);
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  vite.on("exit", (code) => shutdown(code ?? 0));
}

void main();
