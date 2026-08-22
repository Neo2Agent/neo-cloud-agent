import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { controlStateDir } from "../store/persist.js";

export const GITHUB_WEBHOOK_PATH = "/webhooks/github";

export function githubWebhookSecretFile(): string {
  return path.join(controlStateDir(), "github-webhook.secret");
}

function readSecretFile(): string | null {
  try {
    const existing = readFileSync(githubWebhookSecretFile(), "utf8").trim();
    return existing || null;
  } catch {
    return null;
  }
}

export function readGitHubWebhookSecret(): string | null {
  const fromEnv = (process.env.GITHUB_WEBHOOK_SECRET ?? "").trim();
  return fromEnv || readSecretFile();
}

export function ensureGitHubWebhookSecret(): string {
  const existing = readGitHubWebhookSecret();
  if (existing) {
    return existing;
  }
  const file = githubWebhookSecretFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  console.log(`GitHub webhook secret written to ${file}`);
  return secret;
}

export function publicGitHubWebhookInfo(): { path: string; configured: boolean } {
  return {
    path: GITHUB_WEBHOOK_PATH,
    configured: Boolean(readGitHubWebhookSecret()),
  };
}

export function verifyGitHubSignature(raw: Buffer, secret: string, header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = value.slice("sha256=".length).trim();
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}
