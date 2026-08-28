import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { SECRET_ENV_KEYS } from "@neo-cloud-agent/contracts";

export type LocalShell = {
  id: string;
  cwd: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type LocalShellHooks = {
  onData: (id: string, chunk: string) => void;
  onExit: (id: string, code: number | null) => void;
};

function defaultShell(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.COMSPEC || "cmd.exe", args: [] };
  }
  const shell = process.env.SHELL || "/bin/bash";
  return { command: shell, args: ["-i"] };
}

/**
 * A shell rooted at the workspace folder.
 *
 * This is a piped shell, not a pty: a real terminal device needs a native
 * module, and this repo only allows esbuild to run install scripts. Commands,
 * output, and input all work; full-screen TUIs that require a tty do not.
 * `createLocalShell` is the seam to swap in node-pty later without touching
 * callers.
 */
export function createLocalShell(input: { cwd: string; hooks: LocalShellHooks; env?: NodeJS.ProcessEnv }): LocalShell {
  const id = `term_${randomBytes(4).toString("hex")}`;
  const { command, args } = defaultShell();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...input.env,
    // Programs that probe for a terminal should not emit control sequences.
    TERM: "dumb",
    HOME: process.env.HOME || os.homedir(),
    PWD: input.cwd,
  };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  const child: ChildProcess = spawn(command, args, {
    cwd: input.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => input.hooks.onData(id, String(chunk)));
  child.stderr?.on("data", (chunk) => input.hooks.onData(id, String(chunk)));
  child.on("exit", (code) => input.hooks.onExit(id, code));
  child.on("error", (error) => {
    input.hooks.onData(id, `${error instanceof Error ? error.message : String(error)}\n`);
    input.hooks.onExit(id, 1);
  });
  return {
    id,
    cwd: input.cwd,
    write(data) {
      child.stdin?.write(data);
    },
    resize(cols, rows) {
      // No tty to resize. Kept so callers do not special-case the pipe shell.
      void cols;
      void rows;
    },
    kill() {
      child.kill("SIGTERM");
    },
  };
}
