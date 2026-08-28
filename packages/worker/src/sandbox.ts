import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { isInsideWorkspace } from "./hooks.js";

/** pi builtins that take a single `path` argument. */
const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);

/** The subset of those that change a file. */
const WRITE_TOOLS = new Set(["write", "edit"]);

/**
 * Paths that stay write-protected even though they are inside the workspace.
 *
 * A This Computer run edits the user's real checkout in place, so a write here
 * outlives the turn and escapes the boundary after the fact: a git hook runs on
 * the user's next commit, and `.git/config` can repoint `origin` or
 * `core.hooksPath`. Reads stay allowed, and git's own writes go through the git
 * process rather than a tool call, so normal commits and branches are
 * unaffected. `.neo` is this run's private scratch, written by Desk and by the
 * worker: an agent editing it could swap a parallel run's expert persona out
 * from under it.
 */
const PROTECTED_RELATIVE_PATHS = [".git/config", ".git/hooks", ".git/info/attributes", ".neo"];

/** The protected prefix a write lands in, or null when it is somewhere else. */
export function protectedWorkspacePath(workspaceDir: string, target: string): string | null {
  const root = path.resolve(workspaceDir);
  if (!isInsideWorkspace(root, target)) {
    return null;
  }
  const relative = path.relative(root, target).split(path.sep).join("/");
  for (const guarded of PROTECTED_RELATIVE_PATHS) {
    if (relative === guarded || relative.startsWith(`${guarded}/`)) {
      return guarded;
    }
  }
  return null;
}

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

/** The `path` a file tool was pointed at, resolved, or empty when it has none. */
function fileToolTarget(workspaceDir: string, toolName: string, input: unknown): string {
  if (!PATH_TOOLS.has(toolName)) {
    return "";
  }
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const raw = typeof record.path === "string" ? record.path : "";
  return raw ? resolveAgainstWorkspace(workspaceDir, raw) : "";
}

/** True when a pi file tool would touch something outside the workspace. */
export function fileToolEscapes(workspaceDir: string, toolName: string, input: unknown): boolean {
  if (!PATH_TOOLS.has(toolName)) {
    return false;
  }
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (typeof record.path !== "string" || !record.path) {
    return false;
  }
  const resolved = fileToolTarget(workspaceDir, toolName, input);
  return !resolved || !isInsideWorkspace(workspaceDir, resolved);
}

/** The protected prefix a file tool would write into, or null. */
export function fileToolWritesProtectedPath(
  workspaceDir: string,
  toolName: string,
  input: unknown,
): string | null {
  if (!WRITE_TOOLS.has(toolName)) {
    return null;
  }
  const resolved = fileToolTarget(workspaceDir, toolName, input);
  return resolved ? protectedWorkspacePath(workspaceDir, resolved) : null;
}

function looksLikePath(token: string): boolean {
  const value = token.replace(/^["']|["']$/g, "");
  return value.startsWith("/") || value.startsWith("~") || value.includes("../");
}

/**
 * Every path a command looks like it would write to.
 *
 * Best effort by design: a guardrail, not a shell parser. The hard boundary for
 * reads and edits stays on the file tools above. `fromRedirect` matters because
 * a redirect target is always a path, while a mutating command's arguments need
 * a second look before one is treated as one.
 */
function shellWriteTargets(command: string): Array<{ token: string; fromRedirect: boolean }> {
  const targets: Array<{ token: string; fromRedirect: boolean }> = [];
  if (!command.trim()) {
    return targets;
  }
  const redirect = /(?:^|[^0-9<>&])>{1,2}\s*([^\s;|&()]+)/g;
  for (let match = redirect.exec(command); match; match = redirect.exec(command)) {
    const token = match[1] ?? "";
    if (token === "/dev/null" || token === "/dev/stdout" || token === "/dev/stderr") {
      continue;
    }
    targets.push({ token, fromRedirect: true });
  }
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const head = tokens[0] ? path.basename(tokens[0].replace(/^["']|["']$/g, "")) : "";
    if (!MUTATING_COMMANDS.has(head)) {
      continue;
    }
    for (const token of tokens.slice(1)) {
      if (token.startsWith("-")) {
        continue;
      }
      targets.push({ token, fromRedirect: false });
    }
  }
  return targets;
}

/** The token a command would write outside the workspace, or null. */
export function shellWriteEscapes(workspaceDir: string, command: string): string | null {
  for (const { token, fromRedirect } of shellWriteTargets(command)) {
    // An argument that does not look like a path is more likely a flag value or
    // a file name inside the workspace, so leave it to the file-tool boundary.
    if (!fromRedirect && !looksLikePath(token)) {
      continue;
    }
    const resolved = resolveAgainstWorkspace(workspaceDir, token);
    if (resolved && !allowedTarget(workspaceDir, resolved)) {
      return token;
    }
  }
  return null;
}

/**
 * The protected path a command would write into, and the token that named it.
 *
 * Unlike the boundary check this looks at plain relative arguments too, because
 * `rm -rf .git/hooks` is exactly the shape that matters here. Both halves are
 * returned so the refusal can quote what the agent wrote and explain which rule
 * it hit.
 */
export function shellWriteHitsProtectedPath(
  workspaceDir: string,
  command: string,
): { token: string; guarded: string } | null {
  for (const { token } of shellWriteTargets(command)) {
    const resolved = resolveAgainstWorkspace(workspaceDir, token);
    const guarded = resolved ? protectedWorkspacePath(workspaceDir, resolved) : null;
    if (guarded) {
      return { token, guarded };
    }
  }
  return null;
}

function protectedPathReason(guarded: string, target: string): string {
  const named = target && target !== guarded ? `${target}（属于 \`${guarded}\`）` : `\`${guarded}\``;
  if (guarded === ".neo") {
    return `${named} 是本机对话自己的暂存目录，由 Desk 和 worker 维护，Agent 不要改。`;
  }
  return `${named} 不允许改：写进去的东西会在这一轮结束后继续生效（git hook 会在用户下次提交时执行，config 能改 origin 和 hooksPath）。要动 git 配置请用 git 命令，并先告诉用户你打算做什么。`;
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
        const guardedFile = fileToolWritesProtectedPath(root, event.toolName, event.input);
        if (guardedFile) {
          const record = event.input as Record<string, unknown>;
          const named = typeof record.path === "string" ? record.path : guardedFile;
          return { block: true, reason: protectedPathReason(guardedFile, named) };
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
          const guarded = shellWriteHitsProtectedPath(root, command);
          if (guarded) {
            return { block: true, reason: protectedPathReason(guarded.guarded, guarded.token) };
          }
        }
        return undefined;
      });
    },
  };
}
