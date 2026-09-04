import { mkdirSync } from "node:fs";
import path from "node:path";
import { isInsideWorkspace } from "./hooks.js";
import {
  followPathThroughSymlinks,
  protectedWorkspacePath,
  shellLinkEscapes,
  shellWriteEscapes,
  shellWriteHitsProtectedPath,
} from "./sandbox.js";

export type PathGuardError = {
  code: "escaped" | "protected";
  message: string;
};

function resolvedRoot(dir: string): string {
  return path.resolve(dir);
}

/** Resolve a channel-relative path against the sandbox root. */
export function resolveSandboxPath(sandboxRoot: string, raw: string): string {
  const root = resolvedRoot(sandboxRoot);
  const trimmed = raw.trim() || ".";
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  return path.resolve(root, trimmed);
}

export function assertReadablePath(sandboxRoot: string, raw: string): string | PathGuardError {
  const root = resolvedRoot(sandboxRoot);
  const target = followPathThroughSymlinks(resolveSandboxPath(root, raw));
  if (!isInsideWorkspace(root, target)) {
    return { code: "escaped", message: `路径超出了工作区 ${root}` };
  }
  return target;
}

export function assertWritablePath(sandboxRoot: string, raw: string): string | PathGuardError {
  const readable = assertReadablePath(sandboxRoot, raw);
  if (typeof readable !== "string") {
    return readable;
  }
  const guarded = protectedWorkspacePath(sandboxRoot, readable);
  if (guarded) {
    return { code: "protected", message: `${guarded} 不允许通过工具通道改写` };
  }
  return readable;
}

export function assertExecCommand(sandboxRoot: string, command: string): PathGuardError | null {
  const escaped = shellWriteEscapes(sandboxRoot, command) ?? shellLinkEscapes(sandboxRoot, command);
  if (escaped) {
    return { code: "escaped", message: `命令会写到工作区之外（${escaped}）` };
  }
  const guarded = shellWriteHitsProtectedPath(sandboxRoot, command);
  if (guarded) {
    return { code: "protected", message: `${guarded.guarded} 不允许通过工具通道改写` };
  }
  return null;
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}
