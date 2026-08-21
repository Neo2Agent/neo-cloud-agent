import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnvironmentJson, type EnvironmentJson, type TerminalSpec } from "@neo-cloud-agent/contracts";

const CANDIDATES = [".neo/environment.json", ".cursor/environment.json"] as const;

export type BootPlan = {
  cwd: string;
  file: string;
  start?: string;
  terminals: TerminalSpec[];
  config: EnvironmentJson;
};

function readEnvFile(file: string): EnvironmentJson | null {
  if (!existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  return parseEnvironmentJson(JSON.parse(readFileSync(file, "utf8")));
}

function findEnv(dir: string): { file: string; config: EnvironmentJson } | null {
  for (const rel of CANDIDATES) {
    const file = path.join(dir, rel);
    const config = readEnvFile(file);
    if (config) {
      return { file, config };
    }
  }
  return null;
}

export function findBootPlans(workspaceDir: string): BootPlan[] {
  if (!existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
    return [];
  }
  const roots: Array<{ cwd: string; file: string; config: EnvironmentJson }> = [];
  const root = findEnv(workspaceDir);
  if (root) {
    roots.push({ cwd: workspaceDir, ...root });
  } else {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const found = findEnv(path.join(workspaceDir, entry.name));
      if (found) {
        roots.push({ cwd: path.join(workspaceDir, entry.name), ...found });
      }
    }
  }
  return roots
    .filter((root) => Boolean(root.config.start?.trim()) || (root.config.terminals?.length ?? 0) > 0)
    .map((root) => ({
      cwd: root.cwd,
      file: root.file,
      start: root.config.start?.trim() || undefined,
      terminals: root.config.terminals ?? [],
      config: root.config,
    }));
}
