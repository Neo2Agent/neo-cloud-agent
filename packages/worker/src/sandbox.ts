import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { isInsideWorkspace } from "./hooks.js";

/** pi builtins that take a single `path` argument. */
const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);

/** Shell builtins that change the filesystem, so their path arguments are writes. */
const MUTATING_COMMANDS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "touch",
  "mkdir",
  "install",
  "tee",
  "truncate",
  "dd",
  "chmod",
  "chown",
  "chgrp",
  "ln",
  "shred",
]);

/**
 * Writes outside the workspace are blocked, but build tooling legitimately uses
 * the system temp dir, so it stays allowed.
 */
function writableRoots(workspaceDir: string): string[] {
  return [path.resolve(workspaceDir), path.resolve(tmpdir())];
}

function allowedTarget(workspaceDir: string, target: string): boolean {
  return writableRoots(workspaceDir).some((root) => isInsideWorkspace(root, target));
}

function resolveAgainstWorkspace(workspaceDir: string, raw: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value) {
    return "";
  }
  if (value.startsWith("~")) {
    // `~` is the user's home, which is never the workspace.
    return path.join("/__home__", value.slice(1));
  }
  return path.resolve(workspaceDir, value);
}

/** True when a pi file tool would touch something outside the workspace. */
export function fileToolEscapes(workspaceDir: string, toolName: string, input: unknown): boolean {
  if (!PATH_TOOLS.has(toolName)) {
    return false;
  }
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const raw = typeof record.path === "string" ? record.path : "";
  if (!raw) {
    return false;
  }
  const resolved = resolveAgainstWorkspace(workspaceDir, raw);
  return !resolved || !isInsideWorkspace(workspaceDir, resolved);
}

function looksLikePath(token: string): boolean {
  const value = token.replace(/^["']|["']$/g, "");
  return value.startsWith("/") || value.startsWith("~") || value.includes("../");
}

/**
 * Best-effort shell check: catch redirections and mutating commands aimed
 * outside the workspace. This is a guardrail, not a full shell parser, so the
 * hard boundary for reads and edits stays on the file tools above.
 */
export function shellWriteEscapes(workspaceDir: string, command: string): string | null {
  if (!command.trim()) {
    return null;
  }
  const redirect = /(?:^|[^0-9<>&])>{1,2}\s*([^\s;|&()]+)/g;
  for (let match = redirect.exec(command); match; match = redirect.exec(command)) {
    const target = match[1] ?? "";
    if (target === "/dev/null" || target === "/dev/stdout" || target === "/dev/stderr") {
      continue;
    }
    const resolved = resolveAgainstWorkspace(workspaceDir, target);
    if (resolved && !allowedTarget(workspaceDir, resolved)) {
      return target;
    }
  }
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const head = tokens[0] ? path.basename(tokens[0].replace(/^["']|["']$/g, "")) : "";
    if (!MUTATING_COMMANDS.has(head)) {
      continue;
    }
    for (const token of tokens.slice(1)) {
      if (token.startsWith("-") || !looksLikePath(token)) {
        continue;
      }
      const resolved = resolveAgainstWorkspace(workspaceDir, token);
      if (resolved && !allowedTarget(workspaceDir, resolved)) {
        return token;
      }
    }
  }
  return null;
}

/**
 * Keep the agent inside the folder the user authorized.
 *
 * On a cloud VM the whole machine is the sandbox, so this never mattered. On the
 * user's own computer the workspace is one folder among their real files, so the
 * boundary has to be enforced per tool call.
 */
export function createWorkspaceSandboxExtension(workspaceDir: string): InlineExtension {
  const root = path.resolve(workspaceDir);
  return {
    name: "neo-workspace-sandbox",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event) => {
        if (fileToolEscapes(root, event.toolName, event.input)) {
          return {
            block: true,
            reason: `路径超出了本机工作区 ${root}，只能读写这个文件夹里的内容。`,
          };
        }
        if (event.toolName === "bash") {
          const input = event.input as Record<string, unknown>;
          const command = typeof input.command === "string" ? input.command : "";
          const escaped = shellWriteEscapes(root, command);
          if (escaped) {
            return {
              block: true,
              reason: `命令会写到本机工作区之外（${escaped}），已拦下。工作区是 ${root}。`,
            };
          }
        }
        return undefined;
      });
    },
  };
}
