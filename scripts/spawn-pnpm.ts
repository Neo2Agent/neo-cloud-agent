import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Quote one argument for `cmd.exe /s /c`. */
export function quoteWinCmdArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (!/[\s"]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function corepackPnpmJs(): string | undefined {
  const candidate = path.join(path.dirname(process.execPath), "node_modules/corepack/dist/pnpm.js");
  return existsSync(candidate) ? candidate : undefined;
}

export function pnpmLaunch(args: string[]): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform !== "win32") {
    return { command: "pnpm", args };
  }
  const pnpmJs = corepackPnpmJs();
  if (pnpmJs) {
    return { command: process.execPath, args: [pnpmJs, ...args] };
  }
  const commandLine = ["pnpm", ...args.map(quoteWinCmdArg)].join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}

/** Windows Corepack/npm shims are `.cmd`; Node 24 rejects spawning them without a shell. */
export function spawnPnpm(args: string[], options: SpawnOptions): ChildProcess {
  const launch = pnpmLaunch(args);
  return spawn(launch.command, launch.args, {
    ...options,
    windowsHide: options.windowsHide ?? true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments ?? options.windowsVerbatimArguments,
  });
}

/** `cmd.exe` / pnpm wrappers leave grandchildren on Windows unless the tree is killed. */
export function killSpawned(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill(signal);
}
