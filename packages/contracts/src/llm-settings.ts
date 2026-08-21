import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";

const DEEPSEEK_FLASH_ALIASES = new Set([
  "",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek",
  "ds",
  "neo/deepseek",
  "neo/ds",
  "neo-deepseek",
  "deepseek-v4-flash",
  "deepseek-flash",
]);

const DEEPSEEK_PRO_ALIASES = new Set(["deepseek-v4-pro", "deepseek-pro"]);

export interface LlmSettings {
  upstream: LlmUpstreamMode;
  apiKey: string;
  model?: string;
}

export interface PublicLlmSettings {
  configured: boolean;
  upstream: LlmUpstreamMode;
  model: string | null;
}

export interface LlmSettingsRequest {
  upstream: LlmUpstreamMode;
  apiKey?: string;
  model?: string;
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

export function defaultLlmModel(upstream: LlmUpstreamMode): string {
  if (upstream === "deepseek") {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (upstream === "openai") {
    return "gpt-4o-mini";
  }
  return "mock";
}

/** Map retired DeepSeek aliases onto the current official ids. */
export function canonicalizeLlmModel(upstream: LlmUpstreamMode, model?: string | null): string {
  const requested = (model ?? "").trim();
  if (upstream === "deepseek") {
    if (DEEPSEEK_PRO_ALIASES.has(requested)) {
      return DEEPSEEK_PRO_MODEL;
    }
    if (DEEPSEEK_FLASH_ALIASES.has(requested) || !requested) {
      return DEEPSEEK_FLASH_MODEL;
    }
    return requested;
  }
  return requested || defaultLlmModel(upstream);
}

export function isDeepseekProModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_PRO_MODEL;
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
  return {
    upstream,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
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
    if (!apiKey && upstream === "mock" && !model) {
      return null;
    }
    return { upstream, apiKey, model };
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
    merged.apiKey ? `${keyName}=${merged.apiKey}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(file, `${body}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return publicLlmSettings(merged);
}

export function publicLlmSettings(settings: LlmSettings | null): PublicLlmSettings {
  if (!settings) {
    return { configured: false, upstream: "mock", model: null };
  }
  return {
    configured: Boolean(settings.apiKey) && settings.upstream !== "mock",
    upstream: settings.apiKey ? settings.upstream : "mock",
    model: settings.model
      ? canonicalizeLlmModel(settings.upstream, settings.model)
      : settings.apiKey
        ? defaultLlmModel(settings.upstream)
        : null,
  };
}
