import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnvironmentJson, SECRET_ENV_KEYS, type EnvironmentJson } from "@neo-cloud-agent/contracts";

export const ENV_FILE_CANDIDATES = [".neo/environment.json", ".cursor/environment.json"] as const;

export type InstallTarget = {
  cwd: string;
  file: string;
  command: string;
  config: EnvironmentJson;
};

export function readEnvironmentFile(file: string): EnvironmentJson | null {
  if (!existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  try {
    return parseEnvironmentJson(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    throw new Error(`invalid environment.json: ${file}`);
  }
}

export function findEnvironmentFile(dir: string): { file: string; config: EnvironmentJson } | null {
  for (const rel of ENV_FILE_CANDIDATES) {
    const file = path.join(dir, rel);
    const config = readEnvironmentFile(file);
    if (config) {
      return { file, config };
    }
  }
  return null;
}

export type EnvironmentRoot = {
  cwd: string;
  file: string;
  config: EnvironmentJson;
};

/** Prefer a root environment.json; otherwise collect one per sibling repo. */
export function findEnvironmentRoots(workspaceDir: string): EnvironmentRoot[] {
  if (!existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
    return [];
  }
  const root = findEnvironmentFile(workspaceDir);
  if (root) {
    return [{ cwd: workspaceDir, file: root.file, config: root.config }];
  }
  const roots: EnvironmentRoot[] = [];
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const found = findEnvironmentFile(path.join(workspaceDir, entry.name));
    if (found) {
      roots.push({ cwd: path.join(workspaceDir, entry.name), file: found.file, config: found.config });
    }
  }
  return roots;
}

export function findInstallTargets(workspaceDir: string): InstallTarget[] {
  return findEnvironmentRoots(workspaceDir)
    .filter((root) => root.config.install?.trim())
    .map((root) => ({
      cwd: root.cwd,
      file: root.file,
      command: root.config.install!.trim(),
      config: root.config,
    }));
}

export function findBootPlans(workspaceDir: string): EnvironmentRoot[] {
  return findEnvironmentRoots(workspaceDir).filter(
    (root) => Boolean(root.config.start?.trim()) || (root.config.terminals?.length ?? 0) > 0,
  );
}

export function installTimeoutMs(): number {
  return Number(process.env.INSTALL_TIMEOUT_MS ?? 300_000);
}

export function installEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function runInstallCommand(
  cwd: string,
  command: string,
  timeoutMs = installTimeoutMs(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: installEnv(),
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
      reject(new Error(`install timed out after ${timeoutMs}ms`));
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
