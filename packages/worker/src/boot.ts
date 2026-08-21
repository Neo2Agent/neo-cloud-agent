import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { SECRET_ENV_KEYS, type RunEvent, type RunEventKind } from "@neo-cloud-agent/contracts";
import { findBootPlans } from "./environment.js";

export type TerminalHandle = {
  name: string;
  child: ChildProcess;
};

export type BootResult = {
  events: RunEvent[];
  terminals: TerminalHandle[];
  fatal: boolean;
};

function bootEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEO_RUNTIME_SECRET_")) {
      delete env[key];
    }
  }
  return env;
}

function event(runId: string, kind: RunEventKind, title: string, extra?: Partial<RunEvent>): RunEvent {
  return {
    id: extra?.id ?? crypto.randomUUID(),
    runId,
    createdAt: extra?.createdAt ?? new Date().toISOString(),
    category: "agent_setup",
    level: extra?.level ?? (kind.endsWith("_failed") ? "error" : "info"),
    kind,
    title,
    detail: extra?.detail,
    data: extra?.data,
  };
}

function runCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: bootEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`start timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function startTimeoutMs(): number {
  return Number(process.env.START_TIMEOUT_MS ?? 60_000);
}

function startMustSucceed(plan: { config: { startMustSucceed?: boolean } }): boolean {
  return plan.config.startMustSucceed === true || process.env.START_MUST_SUCCEED === "1";
}

export async function runWorkspaceBoot(input: { runId: string; workspaceDir: string }): Promise<BootResult> {
  const events: RunEvent[] = [];
  const terminals: TerminalHandle[] = [];
  const logDir = path.join(input.workspaceDir, ".neo", "logs");
  let fatal = false;

  for (const plan of findBootPlans(input.workspaceDir)) {
    if (plan.start) {
      events.push(event(input.runId, "run.start_started", "Running environment start", { data: { file: plan.file } }));
      try {
        const result = await runCommand(plan.cwd, plan.start, startTimeoutMs());
        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout || `start exited ${result.code}`).trim().slice(-2000);
          const must = startMustSucceed(plan);
          events.push(
            event(input.runId, "run.start_failed", "Environment start failed", {
              detail,
              data: { fatal: must },
            }),
          );
          if (must) {
            fatal = true;
            break;
          }
        } else {
          events.push(event(input.runId, "run.start_succeeded", "Environment start finished"));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "environment start failed";
        const must = startMustSucceed(plan);
        events.push(
          event(input.runId, "run.start_failed", "Environment start failed", {
            detail,
            data: { fatal: must },
          }),
        );
        if (must) {
          fatal = true;
          break;
        }
      }
    }

    for (const terminal of plan.terminals) {
      mkdirSync(logDir, { recursive: true });
      const log = createWriteStream(path.join(logDir, `${terminal.name}.log`), { flags: "a" });
      const child = spawn("bash", ["-lc", terminal.command], {
        cwd: plan.cwd,
        env: bootEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.pipe(log);
      child.stderr?.pipe(log);
      terminals.push({ name: terminal.name, child });
      const immediate = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 400);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      });
      if (immediate !== null && immediate !== 0) {
        events.push(
          event(input.runId, "run.terminal_failed", `Terminal ${terminal.name} failed`, {
            detail: `exited ${immediate}`,
            data: { name: terminal.name },
          }),
        );
      } else {
        events.push(
          event(input.runId, "run.terminal_started", `Terminal ${terminal.name} started`, {
            data: { name: terminal.name, command: terminal.command, pid: child.pid ?? null },
          }),
        );
        if (immediate === 0) {
          events.push(
            event(input.runId, "run.terminal_exited", `Terminal ${terminal.name} exited`, {
              data: { name: terminal.name, code: 0 },
            }),
          );
        }
      }
    }
  }

  return { events, terminals, fatal };
}

export function stopTerminals(handles: TerminalHandle[]): void {
  for (const handle of handles) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill("SIGTERM");
    }
  }
}
