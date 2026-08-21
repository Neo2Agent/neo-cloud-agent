import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { EnvironmentJson } from "@neo-cloud-agent/contracts";
import { parseEnvironmentJson } from "./store.js";

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

/** Prefer a root environment.json; otherwise collect one per sibling repo. */
export function findInstallTargets(workspaceDir: string): InstallTarget[] {
  if (!existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
    return [];
  }
  const root = findEnvironmentFile(workspaceDir);
  if (root?.config.install?.trim()) {
    return [{ cwd: workspaceDir, file: root.file, command: root.config.install.trim(), config: root.config }];
  }
  const targets: InstallTarget[] = [];
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const found = findEnvironmentFile(path.join(workspaceDir, entry.name));
    if (found?.config.install?.trim()) {
      targets.push({
        cwd: path.join(workspaceDir, entry.name),
        file: found.file,
        command: found.config.install.trim(),
        config: found.config,
      });
    }
  }
  return targets;
}

export function installTimeoutMs(): number {
  return Number(process.env.INSTALL_TIMEOUT_MS ?? 300_000);
}

const SECRET_ENV = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_GATEWAY_JWT_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

export function installEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of SECRET_ENV) {
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
