import path from "node:path";

export function resolveWorkspacePath(workspaceDir: string, rel: string): string {
  const dest = path.resolve(workspaceDir, rel);
  const root = path.resolve(workspaceDir);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error("path escapes the workspace");
  }
  return dest;
}
