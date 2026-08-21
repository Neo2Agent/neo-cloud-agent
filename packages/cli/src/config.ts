import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CliIo } from "./io.js";

export const DEFAULT_API_URL = "http://127.0.0.1:8080";

export interface StoredConfig {
  url?: string;
}

export interface StoredCredentials {
  token?: string;
}

export function configDir(io: CliIo): string {
  const override = io.env.NEO_CONFIG_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const xdg = io.env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return path.join(xdg, "neo");
  }
  return path.join(io.homedir(), ".config", "neo");
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadStoredConfig(io: CliIo): StoredConfig {
  return readJsonFile<StoredConfig>(path.join(configDir(io), "config.json")) ?? {};
}

export function loadStoredCredentials(io: CliIo): StoredCredentials {
  return readJsonFile<StoredCredentials>(path.join(configDir(io), "credentials.json")) ?? {};
}

export function saveStoredConfig(io: CliIo, config: StoredConfig): void {
  const dir = configDir(io);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export function saveStoredCredentials(io: CliIo, credentials: StoredCredentials): void {
  const dir = configDir(io);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "credentials.json");
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function clearStoredCredentials(io: CliIo): void {
  try {
    rmSync(path.join(configDir(io), "credentials.json"));
  } catch {
    // already gone
  }
}

export function resolveApiUrl(io: CliIo, flag?: string): string {
  const raw = flag?.trim() || io.env.NEO_API_URL?.trim() || loadStoredConfig(io).url?.trim() || DEFAULT_API_URL;
  return raw.replace(/\/$/, "");
}

export function resolveApiToken(io: CliIo, flag?: string): string | undefined {
  const fromFlag = flag?.trim();
  if (fromFlag) {
    return fromFlag;
  }
  for (const key of ["NEO_API_KEY", "NEO_API_TOKEN", "NEO_TOKEN", "CONTROL_PLANE_TOKEN"] as const) {
    const value = io.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return loadStoredCredentials(io).token?.trim() || undefined;
}
