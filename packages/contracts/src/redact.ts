import type { RunEvent } from "./events.js";

export const SECRET_ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_UPSTREAM_API_KEY",
  "LLM_GATEWAY_JWT_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SCM_PUSH_TOKEN",
] as const;

const MIN_SECRET_LENGTH = 8;

export function secretValuesFromEnv(
  env: Record<string, string | undefined> = process.env,
  extra: string[] = [],
): string[] {
  const values: string[] = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && value.length >= MIN_SECRET_LENGTH) {
      values.push(value);
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("NEO_RUNTIME_SECRET_") && value && value.trim().length >= MIN_SECRET_LENGTH) {
      values.push(value.trim());
    }
  }
  for (const value of extra) {
    if (value && value.length >= MIN_SECRET_LENGTH) {
      values.push(value);
    }
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

export function redactJson(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, secrets));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactJson(item, secrets);
    }
    return out;
  }
  return value;
}

export function redactRunEvent(event: RunEvent, secrets: string[]): RunEvent {
  if (secrets.length === 0) {
    return event;
  }
  return {
    ...event,
    title: redactText(event.title, secrets),
    detail: event.detail !== undefined ? redactText(event.detail, secrets) : undefined,
    data: event.data ? (redactJson(event.data, secrets) as Record<string, unknown>) : undefined,
  };
}
