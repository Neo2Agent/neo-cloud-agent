import { type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deskClientOrigin, isLoopbackOrigin } from "../src/ports.ts";
import { ensureBackend } from "../../../scripts/ensure-backend.ts";
import { ensureWebUi } from "../../../scripts/ensure-web.ts";
import { spawnPnpm, killSpawned } from "../../../scripts/spawn-pnpm.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function launchDesk(opts: {
  title: string;
  userData: string;
  x: number;
  width: number;
  apiBase: string;
  uiUrl: string;
  cdpPort?: number;
}): ChildProcess {
  const cdp = opts.cdpPort ? [`--remote-debugging-port=${opts.cdpPort}`] : [];
  return spawnPnpm(["exec", "electron", `--user-data-dir=${opts.userData}`, ...cdp, "app/main.cjs"], {
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
  const apiBase = deskClientOrigin(process.env, { production: false });
  if (isLoopbackOrigin(apiBase)) {
    await ensureBackend();
  }
  const override = (process.env.NEO_DESK_URL || "").replace(/\/$/, "");
  const { url: uiUrl, child: vite } = override
    ? { url: override, child: null }
    : await ensureWebUi({ apiBase });
  const width = 960;
  const cdpBase = Number(process.env.NEO_DESK_CDP_PORT || 0);
  const left = launchDesk({
    title: "Neo Desk · A",
    userData: "/tmp/neo-desk-a",
    x: 0,
    width,
    apiBase,
    uiUrl,
    cdpPort: cdpBase || undefined,
  });
  const right = launchDesk({
    title: "Neo Desk · B",
    userData: "/tmp/neo-desk-b",
    x: width,
    width,
    apiBase,
    uiUrl,
    cdpPort: cdpBase ? cdpBase + 1 : undefined,
  });
  const stop = () => {
    killSpawned(left);
    killSpawned(right);
    if (vite) killSpawned(vite);
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
