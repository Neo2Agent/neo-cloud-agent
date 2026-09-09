import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalizeLlmModel,
  defaultLlmModel,
  type LlmUpstreamMode,
} from "./llm-ids.js";

export type { LlmUpstreamMode } from "./llm-ids.js";
export {
  canonicalizeLlmModel,
  DEEPSEEK_FLASH_MODEL,
  DEEPSEEK_PRO_MODEL,
  DEEPSEEK_VISION_MODEL,
  defaultLlmModel,
  isDeepseekProModel,
  isDeepseekVisionModel,
  visionModelFor,
} from "./llm-ids.js";

export interface LlmSettings {
  upstream: LlmUpstreamMode;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export type NewApiPublicInfo = { url: string | null; consoleUrl: string | null };

export interface PublicLlmSettings {
  configured: boolean;
  upstream: LlmUpstreamMode;
  model: string | null;
  baseUrl: string | null;
  newApi?: NewApiPublicInfo;
}

export function readNewApiInfo(env: NodeJS.ProcessEnv = process.env): NewApiPublicInfo {
  const url = (env.NEW_API_URL ?? "").trim() || null;
  const consoleUrl = (env.NEW_API_CONSOLE_URL ?? "").trim() || null;
  return { url, consoleUrl };
}

export interface LlmSettingsRequest {
  upstream: LlmUpstreamMode;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

const FILE_NAME = path.join(".neo", "llm-upstream.env");

export function resolveLlmSettingsRoot(start = process.cwd()): string {
  if (process.env.LLM_SETTINGS_DIR) {
    return process.env.LLM_SETTINGS_DIR;
  }
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.resolve(start);
}

export function llmSettingsFile(root = resolveLlmSettingsRoot()): string {
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

function parseUpstream(value: string | undefined): LlmUpstreamMode | undefined {
  if (value === "openai" || value === "deepseek" || value === "mock") {
    return value;
  }
  return undefined;
}

export function parseLlmSettingsRequest(body: unknown): LlmSettingsRequest {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const upstream = parseUpstream(typeof raw.upstream === "string" ? raw.upstream : undefined);
  if (!upstream) {
    throw new Error("upstream must be mock, openai, or deepseek");
  }
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  if (/[\r\n]/.test(apiKey)) {
    throw new Error("apiKey must be a single line");
  }
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim().replace(/\/$/, "") : "";
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("baseUrl must be an http(s) URL");
  }
  return {
    upstream,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function readLlmSettings(root?: string): LlmSettings | null {
  try {
    const parsed = parseEnv(readFileSync(llmSettingsFile(root), "utf8"));
    const upstream = parseUpstream(parsed.LLM_UPSTREAM) ?? "deepseek";
    const apiKey =
      parsed.DEEPSEEK_API_KEY ||
      parsed.OPENAI_API_KEY ||
      parsed.LLM_UPSTREAM_API_KEY ||
      parsed.LLM_API_KEY ||
      "";
    const model = parsed.LLM_UPSTREAM_MODEL
      ? canonicalizeLlmModel(upstream, parsed.LLM_UPSTREAM_MODEL)
      : undefined;
    const baseUrl = (parsed.LLM_UPSTREAM_BASE_URL ?? "").trim().replace(/\/$/, "") || undefined;
    if (!apiKey && upstream === "mock" && !model) {
      return null;
    }
    return { upstream, apiKey, model, baseUrl };
  } catch {
    return null;
  }
}

export function writeLlmSettings(settings: LlmSettingsRequest, root?: string): PublicLlmSettings {
  const existing = readLlmSettings(root);
  const merged: LlmSettings = {
    upstream: settings.upstream,
    apiKey: settings.apiKey || existing?.apiKey || "",
    model: canonicalizeLlmModel(
      settings.upstream,
      settings.model || existing?.model || defaultLlmModel(settings.upstream),
    ),
    baseUrl: (settings.baseUrl || existing?.baseUrl || "").replace(/\/$/, "") || undefined,
  };
  if (merged.upstream !== "mock" && !merged.apiKey) {
    throw new Error("apiKey is required");
  }
  const file = llmSettingsFile(root);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const keyName = merged.upstream === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
  const body = [
    "# Written by Neo Cloud Agent. Do not commit.",
    `LLM_UPSTREAM=${merged.upstream}`,
    `LLM_UPSTREAM_MODEL=${merged.model ?? defaultLlmModel(merged.upstream)}`,
    merged.baseUrl ? `LLM_UPSTREAM_BASE_URL=${merged.baseUrl}` : "",
    merged.apiKey ? `${keyName}=${merged.apiKey}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(file, `${body}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return publicLlmSettings(merged);
}

export function publicLlmSettings(settings: LlmSettings | null): PublicLlmSettings {
  const newApi = readNewApiInfo();
  if (!settings) {
    return { configured: false, upstream: "mock", model: null, baseUrl: null, newApi };
  }
  return {
    configured: Boolean(settings.apiKey) && settings.upstream !== "mock",
    upstream: settings.apiKey ? settings.upstream : "mock",
    model: settings.model
      ? canonicalizeLlmModel(settings.upstream, settings.model)
      : settings.apiKey
        ? defaultLlmModel(settings.upstream)
        : null,
    baseUrl: settings.baseUrl ?? null,
    newApi,
  };
}
