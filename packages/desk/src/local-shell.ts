import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
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

export function shellLaunch(platform = process.platform): {
  command: string;
  args: string[];
  stdoutEncoding: BufferEncoding;
} {
  if (platform === "win32") {
    // /U is output-only. Stdin stays 8-bit; writing UTF-16 makes cmd show More?
    return { command: process.env.COMSPEC || "cmd.exe", args: ["/d", "/u"], stdoutEncoding: "utf16le" };
  }
  const shell = process.env.SHELL || "/bin/bash";
  return { command: shell, args: ["-i"], stdoutEncoding: "utf8" };
}

/**
 * Node's pipes are socketpairs, and macOS `script` refuses those (tcgetattr).
 * Python's pty.fork gives the shell a real tty and relays bytes across the socket.
 */
const PTY_RELAY = `
import os, pty, select, sys
os.chdir(sys.argv[1])
shell = sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execvp(shell, [shell, "-i"])
stdin = sys.stdin.buffer.fileno()
stdout = sys.stdout.buffer.fileno()
while True:
    ready, _, _ = select.select([fd, stdin], [], [], 0.5)
    if fd in ready:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        os.write(stdout, data)
    if stdin in ready:
        data = os.read(stdin, 4096)
        if not data:
            break
        os.write(fd, data)
os._exit(0)
`;

/**
 * A real tty, the way Cursor's terminal is a local shell and not a pipe.
 * Unix relays through Python's pty. Windows stays on piped cmd.
 */
export function interactiveShellLaunch(platform = process.platform, cwd = process.cwd()): {
  command: string;
  args: string[];
  stdoutEncoding: BufferEncoding;
} {
  const inner = shellLaunch(platform);
  if (platform === "win32") return inner;
  return {
    command: "python3",
    args: ["-u", "-c", PTY_RELAY, cwd, inner.command],
    stdoutEncoding: "utf8",
  };
}

/**
 * A shell rooted at the workspace folder.
 *
 * Unix uses `script` so the session has a pty (prompt, line editing) without a
 * native module. Windows stays on a piped cmd. Full-screen TUIs are still weak.
 */
export function createLocalShell(input: { cwd: string; hooks: LocalShellHooks; env?: NodeJS.ProcessEnv }): LocalShell {
  const id = `term_${randomBytes(4).toString("hex")}`;
  const { command, args, stdoutEncoding } = interactiveShellLaunch(process.platform, input.cwd);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...input.env,
    TERM: process.platform === "win32" ? "dumb" : "xterm-256color",
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
    windowsHide: true,
  });
  const stdoutDec = new StringDecoder(stdoutEncoding);
  const stderrDec = new StringDecoder(stdoutEncoding);
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = stdoutDec.write(chunk);
    if (text) {
      input.hooks.onData(id, text);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = stderrDec.write(chunk);
    if (text) {
      input.hooks.onData(id, text);
    }
  });
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
