import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { verifyRunToken } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { controlStateDir } from "../store/persist.js";

export const API_TOKEN_COOKIE = "neo_token";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function apiAuthEnabled(): boolean {
  return Boolean(configuredApiToken() || process.env.CONTROL_PLANE_AUTH === "1" || process.env.CONTROL_PLANE_AUTH === "true");
}

function configuredApiToken(): string | null {
  const token = (process.env.CONTROL_PLANE_TOKEN || process.env.NEO_API_TOKEN || "").trim();
  return token || null;
}

export function resolveApiToken(): string | null {
  const configured = configuredApiToken();
  if (configured) {
    return configured;
  }
  if (!apiAuthEnabled()) {
    return null;
  }
  return loadOrCreateApiToken();
}

function loadOrCreateApiToken(): string {
  const file = path.join(controlStateDir(), "api-token");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch {
    // create below
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const token = `neo_${randomBytes(24).toString("base64url")}`;
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  console.log(`control-plane API token written to ${file}`);
  return token;
}

export function readBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) {
    return null;
  }
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function readApiCredential(req: IncomingMessage, url: URL): string | null {
  return readBearer(req) || readCookie(req, API_TOKEN_COOKIE) || url.searchParams.get("access_token")?.trim() || null;
}

export function matchApiToken(token: string): boolean {
  const expected = resolveApiToken();
  if (!expected) {
    return true;
  }
  return Boolean(token && safeEqual(token, expected));
}

export function verifyApiToken(req: IncomingMessage, url: URL): boolean {
  const expected = resolveApiToken();
  if (!expected) {
    return true;
  }
  const provided = readApiCredential(req, url);
  return Boolean(provided && matchApiToken(provided));
}

export function verifyWorkerJwt(req: IncomingMessage, runId: string): boolean {
  const token = readBearer(req);
  if (!token) {
    return !apiAuthEnabled();
  }
  try {
    const claims = verifyRunToken(getConfig().jwtSecret, token);
    return claims.runId === runId;
  } catch {
    return false;
  }
}

export function cookieHeader(token: string): string {
  return `${API_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}
