import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DESK_UI_PORT, deskClientOrigin, isLoopbackOrigin } from "../src/ports.ts";
import { ensureBackend, waitForHttp } from "../../../scripts/ensure-backend.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function launchDesk(opts: {
  title: string;
  userData: string;
  x: number;
  width: number;
  apiBase: string;
  uiUrl: string;
}): ChildProcess {
  return spawn("pnpm", ["exec", "electron", `--user-data-dir=${opts.userData}`, "app/main.cjs"], {
    cwd: deskRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEO_DESK_URL: opts.uiUrl,
      NEO_CONTROL_PLANE_URL: opts.apiBase,
      NEO_DESK_TITLE: opts.title,
      NEO_DESK_WINDOW_X: String(opts.x),
      NEO_DESK_WINDOW_Y: "32",
      NEO_DESK_WINDOW_WIDTH: String(opts.width),
      NEO_DESK_WINDOW_HEIGHT: "980",
      DISPLAY: process.env.DISPLAY || ":1",
    },
  });
}

async function main(): Promise<void> {
  const uiPort = Number(process.env.NEO_DESK_UI_PORT || DEFAULT_DESK_UI_PORT);
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const apiBase = deskClientOrigin(process.env, { production: false });
  if (isLoopbackOrigin(apiBase)) {
    await ensureBackend();
  }
  const vite = spawn("pnpm", ["exec", "vite", "--config", "ui/vite.config.ts"], {
    cwd: deskRoot,
    stdio: "inherit",
    env: { ...process.env, NEO_DESK_UI_PORT: String(uiPort), NEO_CONTROL_PLANE_URL: apiBase },
  });
  await waitForHttp(uiUrl);
  const width = 960;
  const left = launchDesk({
    title: "Neo Desk · A",
    userData: "/tmp/neo-desk-a",
    x: 0,
    width,
    apiBase,
    uiUrl,
  });
  const right = launchDesk({
    title: "Neo Desk · B",
    userData: "/tmp/neo-desk-b",
    x: width,
    width,
    apiBase,
    uiUrl,
  });
  const stop = () => {
    left.kill("SIGTERM");
    right.kill("SIGTERM");
    vite.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const onExit = () => {
    stop();
    process.exit(0);
  };
  left.on("exit", onExit);
  right.on("exit", onExit);
}

void main();
