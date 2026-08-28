import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DESK_UI_PORT, deskClientOrigin, isLoopbackOrigin } from "../src/ports.ts";
import { ensureBackend, waitForHttp } from "../../../scripts/ensure-backend.ts";
import { spawnPnpm, killSpawned } from "../../../scripts/spawn-pnpm.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
  const uiPort = Number(process.env.NEO_DESK_UI_PORT || DEFAULT_DESK_UI_PORT);
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const production = process.argv.includes("--prod");
  const apiBase = deskClientOrigin(process.env, { production });
  if (isLoopbackOrigin(apiBase)) {
    await ensureBackend();
  } else {
    console.log(`desk client → ${apiBase} (not starting local :8080)`);
  }

  const vite = spawnPnpm(["exec", "vite", "--config", "ui/vite.config.ts"], {
    cwd: deskRoot,
    stdio: "inherit",
    env: { ...process.env, NEO_DESK_UI_PORT: String(uiPort), NEO_CONTROL_PLANE_URL: apiBase },
  });
  await waitForHttp(uiUrl);
  console.log(`desk UI vite on ${uiUrl}; opening Electron (not a browser tab)`);

  const electron = spawnPnpm(["exec", "electron", "app/main.cjs"], {
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
    killSpawned(vite);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  electron.on("exit", (code) => {
    killSpawned(vite);
    process.exit(code ?? 0);
  });
}

void main();
