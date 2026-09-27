import { deskClientOrigin, isLoopbackOrigin } from "../src/ports.ts";
import { ensureBackend, waitForHttp } from "../../../scripts/ensure-backend.ts";
import { ensureWebUi } from "../../../scripts/ensure-web.ts";
import { spawnPnpm, killSpawned } from "../../../scripts/spawn-pnpm.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
  const production = process.argv.includes("--prod");
  const apiBase = deskClientOrigin(process.env, { production });
  if (isLoopbackOrigin(apiBase)) {
    await ensureBackend();
  } else {
    console.log(`desk client → ${apiBase} (not starting local :8080)`);
  }

  const override = (process.env.NEO_DESK_URL || "").replace(/\/$/, "");
  const { url: uiUrl, child: vite } = override
    ? { url: override, child: null }
    : await ensureWebUi({ apiBase });
  await waitForHttp(uiUrl);
  console.log(`desk Electron wraps Web UI ${uiUrl}`);

  const cdpPort = process.env.NEO_DESK_CDP_PORT;
  const electron = spawnPnpm(["exec", "electron", ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []), "app/main.cjs"], {
    cwd: deskRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEO_DESK_URL: uiUrl,
      NEO_CONTROL_PLANE_URL: apiBase,
      DISPLAY: process.env.DISPLAY || ":1",
    },
  });

  const stop = () => {
    killSpawned(electron);
    if (vite) killSpawned(vite);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  electron.on("exit", (code) => {
    if (vite) killSpawned(vite);
    process.exit(code ?? 0);
  });
}

void main();
