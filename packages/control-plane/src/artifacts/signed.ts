import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { publicAppUrl } from "../notify/settings.js";
import { artifactUrl, type StoredArtifact } from "./artifacts.js";

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

function secret(): string {
  return getConfig().jwtSecret || "dev-only-change-me";
}

export function signArtifactAccess(runId: string, name: string, ttlSec = DEFAULT_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${runId}\n${name}\n${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return Buffer.from(JSON.stringify({ runId, name, exp, sig })).toString("base64url");
}

export function verifyArtifactAccess(token: string, runId: string, name: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      runId?: string;
      name?: string;
      exp?: number;
      sig?: string;
    };
    if (parsed.runId !== runId || parsed.name !== name || typeof parsed.exp !== "number" || !parsed.sig) {
      return false;
    }
    if (parsed.exp * 1000 < Date.now()) {
      return false;
    }
    const payload = `${parsed.runId}\n${parsed.name}\n${parsed.exp}`;
    const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
    const left = Buffer.from(parsed.sig);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function signedArtifactUrl(runId: string, name: string): string {
  return `${artifactUrl(runId, name)}?token=${signArtifactAccess(runId, name)}`;
}

export function publicArtifactHref(runId: string, name: string): string {
  const relative = signedArtifactUrl(runId, name);
  const base = publicAppUrl();
  return base ? `${base}${relative}` : relative;
}

export function formatPrArtifactMarkdown(runId: string, artifacts: StoredArtifact[]): string {
  if (artifacts.length === 0) {
    return "";
  }
  const lines = ["## Artifacts", ""];
  for (const item of artifacts) {
    lines.push(`- [${item.name}](${publicArtifactHref(runId, item.name)})`);
  }
  if (!publicAppUrl()) {
    lines.push("", "_Links open on the Neo host; sign in if asked._");
  }
  return lines.join("\n");
}
