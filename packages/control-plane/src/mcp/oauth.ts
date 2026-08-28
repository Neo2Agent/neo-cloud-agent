import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { publicAppUrl } from "../notify/settings.js";
import { readMcpSecrets, upsertMcpSecret } from "./secrets.js";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  return getConfig().jwtSecret || "dev-only-change-me";
}

export function mcpOAuthRedirectUri(origin?: string): string {
  const base = (origin || publicAppUrl() || getConfig().controlPlaneUrl).replace(/\/$/, "");
  return `${base}/oauth/callback/mcp`;
}

export function signMcpOAuthState(name: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${name}\n${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return Buffer.from(JSON.stringify({ name, exp, sig })).toString("base64url");
}

export function verifyMcpOAuthState(state: string): string {
  let parsed: { name?: string; exp?: number; sig?: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      name?: string;
      exp?: number;
      sig?: string;
    };
  } catch {
    throw new Error("invalid OAuth state");
  }
  if (!parsed.name || typeof parsed.exp !== "number" || !parsed.sig) {
    throw new Error("invalid OAuth state");
  }
  if (parsed.exp < Date.now()) {
    throw new Error("OAuth state expired");
  }
  const expected = createHmac("sha256", secret()).update(`${parsed.name}\n${parsed.exp}`).digest("base64url");
  const left = Buffer.from(parsed.sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("invalid OAuth state");
  }
  return parsed.name;
}

export function beginMcpOAuth(name: string, origin?: string): { url: string; redirectUri: string } {
  const key = name.trim();
  const oauth = readMcpSecrets()[key]?.oauth;
  if (!oauth?.authorizeUrl || !oauth.clientId) {
    throw new Error("MCP OAuth is not configured for this server");
  }
  const redirectUri = mcpOAuthRedirectUri(origin);
  const url = new URL(oauth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", oauth.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", signMcpOAuthState(key));
  if (oauth.scopes) {
    url.searchParams.set("scope", oauth.scopes);
  }
  return { url: url.toString(), redirectUri };
}

export async function finishMcpOAuth(
  input: { code: string; state: string; origin?: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const name = verifyMcpOAuthState(input.state);
  const oauth = readMcpSecrets()[name]?.oauth;
  if (!oauth?.tokenUrl || !oauth.clientId) {
    throw new Error("MCP OAuth is not configured for this server");
  }
  const redirectUri = mcpOAuthRedirectUri(input.origin);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    client_id: oauth.clientId,
  });
  if (oauth.clientSecret) {
    body.set("client_secret", oauth.clientSecret);
  }
  const response = await fetchFn(oauth.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  let parsed: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(text || `token exchange failed: ${response.status}`);
  }
  if (!response.ok || !parsed.access_token) {
    throw new Error(parsed.error || text || `token exchange failed: ${response.status}`);
  }
  upsertMcpSecret(name, {
    oauth: {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt:
        typeof parsed.expires_in === "number"
          ? new Date(Date.now() + parsed.expires_in * 1000).toISOString()
          : undefined,
    },
  });
  return name;
}
