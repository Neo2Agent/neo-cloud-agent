import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRODUCTION_CONTROL_PLANE } from "../src/ports.ts";

const deskRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(deskRoot, "../..");
const outDir = path.join(deskRoot, "out");

function run(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function writeLaunch(): void {
  writeFileSync(
    path.join(outDir, "launch.cjs"),
    `"use strict";
process.env.NEO_DESK_PACKAGED = "1";
if (!process.env.NEO_CONTROL_PLANE_URL) {
  process.env.NEO_CONTROL_PLANE_URL = ${JSON.stringify(DEFAULT_PRODUCTION_CONTROL_PLANE)};
}
const { app } = require("electron");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
}
require("./main.cjs");
`,
  );
}

function writeStubWorker(): void {
  writeFileSync(
    path.join(outDir, "worker.cjs"),
    `"use strict";
console.error("This Computer worker is missing from this Desk build.");
process.exit(2);
`,
  );
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(deskRoot, "build"), { recursive: true });

  await run("pnpm", ["exec", "vite", "build", "--config", "ui/vite.config.ts"], {
    cwd: deskRoot,
    env: { ...process.env, NEO_CONTROL_PLANE_URL: DEFAULT_PRODUCTION_CONTROL_PLANE },
  });

  await run(
    "pnpm",
    [
      "exec",
      "esbuild",
      "app/host.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--outfile=out/main.cjs",
      "--external:electron",
    ],
    { cwd: deskRoot },
  );

  copyFileSync(path.join(deskRoot, "app/preload.cjs"), path.join(outDir, "preload.cjs"));
  writeLaunch();
  writeStubWorker();

  try {
    await run(
      "pnpm",
      [
        "exec",
        "esbuild",
        path.join(repoRoot, "packages/worker/src/index.ts"),
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--outfile=out/worker.cjs",
        "--packages=bundle",
      ],
      { cwd: deskRoot },
    );
  } catch (error) {
    console.warn("bundled worker failed; Cloud runs still work, This Computer will not:", error);
  }

  const icon = path.join(outDir, "icon.png");
  await run("python3", [path.join(deskRoot, "scripts/make-icon.py"), icon], { cwd: deskRoot });
  copyFileSync(icon, path.join(deskRoot, "build/icon.png"));

  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  // Build each OS on its own so a Windows wine miss does not drop the Mac zip.
  for (const platform of ["--mac", "--linux", "--win"] as const) {
    try {
      await run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.yml", platform], {
        cwd: deskRoot,
        env,
      });
    } catch (error) {
      console.warn(`electron-builder ${platform} failed:`, error);
    }
  }
}

void main();
