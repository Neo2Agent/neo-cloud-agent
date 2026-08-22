import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export const WORKSPACE_HOOK_FILES = [".cursor/hooks.json", ".neo/hooks.json"] as const;

export type HookEventName =
  | "preToolUse"
  | "beforeShellExecution"
  | "afterFileEdit"
  | "stop"
  | "subagentStart"
  | "subagentStop";

export type WorkspaceHook = {
  event: HookEventName;
  command: string;
  matcher?: string;
  failClosed?: boolean;
};

export type HookDecision = {
  deny: boolean;
  reason?: string;
};

const HOOK_EVENTS = new Set<HookEventName>([
  "preToolUse",
  "beforeShellExecution",
  "afterFileEdit",
  "stop",
  "subagentStart",
  "subagentStop",
]);

const TOOL_ALIASES: Record<string, string[]> = {
  bash: ["bash", "shell"],
  write: ["write"],
  edit: ["edit", "strreplace"],
  read: ["read"],
  neo_subagent: ["neo_subagent", "task", "subagent"],
};

export function isInsideWorkspace(workspaceDir: string, target: string): boolean {
  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function hookMatchesTool(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === "*") {
    return true;
  }
  const aliases = TOOL_ALIASES[toolName] ?? [toolName];
  const names = [toolName, ...aliases].map((item) => item.toLowerCase());
  return matcher.split("|").some((part) => {
    const token = part.trim();
    if (!token) {
      return false;
    }
    try {
      const re = new RegExp(token, "i");
      return names.some((name) => re.test(name));
    } catch {
      return names.includes(token.toLowerCase());
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readHookEntries(event: HookEventName, value: unknown): WorkspaceHook[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const hooks: WorkspaceHook[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const command = typeof record.command === "string" ? record.command.trim() : "";
    if (!command) {
      continue;
    }
    if (record.type && record.type !== "command") {
      continue;
    }
    hooks.push({
      event,
      command,
      matcher: typeof record.matcher === "string" ? record.matcher : undefined,
      failClosed: record.failClosed === true || record.failClosed === "true",
    });
  }
  return hooks;
}

export function parseHooksFile(raw: string): WorkspaceHook[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  const root = asRecord(parsed);
  if (!root) {
    return [];
  }
  const table = asRecord(root.hooks) ?? root;
  const hooks: WorkspaceHook[] = [];
  for (const event of HOOK_EVENTS) {
    hooks.push(...readHookEntries(event, table[event]));
  }
  return hooks;
}

export function loadWorkspaceHooks(workspaceDir: string): WorkspaceHook[] {
  const hooks: WorkspaceHook[] = [];
  for (const relative of WORKSPACE_HOOK_FILES) {
    const file = path.join(workspaceDir, relative);
    if (!existsSync(file) || !isInsideWorkspace(workspaceDir, file)) {
      continue;
    }
    try {
      hooks.push(...parseHooksFile(readFileSync(file, "utf8")));
    } catch {
      // skip unreadable hook files
    }
  }
  return hooks;
}

export function parseHookOutput(text: string): HookDecision {
  const trimmed = text.trim();
  if (!trimmed) {
    return { deny: false };
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const candidates = [trimmed, lines.at(-1) ?? ""];
  for (const candidate of candidates) {
    try {
      const record = asRecord(JSON.parse(candidate));
      if (!record) {
        continue;
      }
      const permission = String(record.permission ?? record.decision ?? "").toLowerCase();
      const denied =
        record.continue === false ||
        permission === "deny" ||
        permission === "block" ||
        permission === "ask";
      const reason =
        (typeof record.user_message === "string" && record.user_message) ||
        (typeof record.reason === "string" && record.reason) ||
        (typeof record.stopReason === "string" && record.stopReason) ||
        (typeof record.message === "string" && record.message) ||
        undefined;
      return { deny: denied, reason };
    } catch {
      // try the next candidate
    }
  }
  return { deny: false };
}

export async function runHookCommand(
  command: string,
  cwd: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<HookDecision> {
  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
        HOME: cwd,
        PWD: cwd,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ deny: false, reason: "hook timed out" });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stdin.on("error", () => {
      // hooks that ignore stdin (printf, true) close the pipe before we finish writing
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ deny: false, reason: "hook failed to start" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseHookOutput(Buffer.concat(stdout).toString("utf8")));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function decideWorkspaceHooks(
  hooks: WorkspaceHook[],
  event: HookEventName,
  toolName: string | undefined,
  payload: unknown,
  cwd: string,
): Promise<HookDecision> {
  for (const hook of hooks) {
    if (hook.event !== event) {
      continue;
    }
    if (toolName && !hookMatchesTool(hook.matcher, toolName)) {
      continue;
    }
    try {
      const decision = await runHookCommand(hook.command, cwd, payload);
      if (decision.deny) {
        return decision;
      }
    } catch (error) {
      if (hook.failClosed) {
        return {
          deny: true,
          reason: error instanceof Error ? error.message : "hook failed",
        };
      }
    }
  }
  return { deny: false };
}

export function createWorkspaceHookExtension(workspaceDir: string): InlineExtension {
  return {
    name: "neo-workspace-hooks",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      const hooks = loadWorkspaceHooks(workspaceDir);
      if (hooks.length === 0) {
        return;
      }
      pi.on("tool_call", async (event) => {
        const toolName = event.toolName;
        const input = event.input as Record<string, unknown>;
        const pre = await decideWorkspaceHooks(
          hooks,
          "preToolUse",
          toolName,
          { hook_event_name: "preToolUse", tool_name: toolName, tool_input: input, cwd: workspaceDir },
          workspaceDir,
        );
        if (pre.deny) {
          return { block: true, reason: pre.reason ?? "blocked by workspace hook" };
        }
        if (toolName === "bash") {
          const shell = await decideWorkspaceHooks(
            hooks,
            "beforeShellExecution",
            toolName,
            {
              hook_event_name: "beforeShellExecution",
              command: input.command,
              cwd: workspaceDir,
              tool_name: toolName,
              tool_input: input,
            },
            workspaceDir,
          );
          if (shell.deny) {
            return { block: true, reason: shell.reason ?? "blocked by workspace hook" };
          }
        }
        if (toolName === "neo_subagent") {
          const nested = await decideWorkspaceHooks(
            hooks,
            "subagentStart",
            toolName,
            { hook_event_name: "subagentStart", tool_name: toolName, tool_input: input, cwd: workspaceDir },
            workspaceDir,
          );
          if (nested.deny) {
            return { block: true, reason: nested.reason ?? "blocked by workspace hook" };
          }
        }
        return undefined;
      });
      pi.on("tool_result", async (event) => {
        if (event.toolName === "write" || event.toolName === "edit") {
          await decideWorkspaceHooks(
            hooks,
            "afterFileEdit",
            event.toolName,
            {
              hook_event_name: "afterFileEdit",
              tool_name: event.toolName,
              tool_input: event.input,
              cwd: workspaceDir,
              is_error: event.isError,
            },
            workspaceDir,
          );
        }
        if (event.toolName === "neo_subagent") {
          await decideWorkspaceHooks(
            hooks,
            "subagentStop",
            event.toolName,
            {
              hook_event_name: "subagentStop",
              tool_name: event.toolName,
              tool_input: event.input,
              cwd: workspaceDir,
              is_error: event.isError,
            },
            workspaceDir,
          );
        }
      });
      pi.on("agent_end", async () => {
        await decideWorkspaceHooks(hooks, "stop", undefined, { hook_event_name: "stop", cwd: workspaceDir }, workspaceDir);
      });
    },
  };
}
