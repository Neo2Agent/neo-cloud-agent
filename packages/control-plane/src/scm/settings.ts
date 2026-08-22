import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveLlmSettingsRoot } from "@neo-cloud-agent/contracts";
import { githubAppConfig } from "./github-app.js";

export type ScmPushMethod = "github-app" | "pat" | "none";

export type PublicScmSettings = {
  configured: boolean;
  method: ScmPushMethod;
};

const FILE_NAME = path.join(".neo", "scm-push.env");

export function scmSettingsFile(root = resolveLlmSettingsRoot()): string {
  return path.join(root, FILE_NAME);
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

export function readStoredScmToken(root?: string): string | null {
  try {
    const parsed = parseEnv(readFileSync(scmSettingsFile(root), "utf8"));
    const token = (parsed.SCM_PUSH_TOKEN || parsed.GITHUB_TOKEN || parsed.GH_TOKEN || "").trim();
    return token || null;
  } catch {
    return null;
  }
}

export function writeScmSettings(
  input: { token?: string; clear?: boolean },
  root?: string,
): PublicScmSettings {
  const file = scmSettingsFile(root);
  if (input.clear) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    } catch {
      // ignore
    }
    return publicScmSettings();
  }
  const token = (input.token ?? "").trim();
  if (!token) {
    return publicScmSettings();
  }
  if (/[\r\n]/.test(token)) {
    throw new Error("token must be a single line");
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `# Written by Neo Cloud Agent. Do not commit.\nSCM_PUSH_TOKEN=${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return publicScmSettings();
}

export function envScmToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SCM_PUSH_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

export function scmPushMethod(env: NodeJS.ProcessEnv = process.env): ScmPushMethod {
  if (githubAppConfig(env)) {
    return "github-app";
  }
  if (envScmToken(env) || readStoredScmToken()) {
    return "pat";
  }
  return "none";
}

export function publicScmSettings(env: NodeJS.ProcessEnv = process.env): PublicScmSettings {
  const method = scmPushMethod(env);
  return { configured: method !== "none", method };
}
