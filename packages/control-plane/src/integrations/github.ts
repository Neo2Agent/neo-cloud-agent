import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getConfig } from "../config.js";
import { publicAppUrl } from "../notify/settings.js";
import {
  deleteGithubConnection,
  getGithubConnection,
  putGithubConnection,
  type GithubConnection,
} from "./github-store.js";

export const GITHUB_OAUTH_SCOPES = "read:user repo";
export const GITHUB_REPOS_LIMIT = 40;

export type PublicGithubAccount = {
  connected: boolean;
  login: string | null;
  oauthConfigured: boolean;
};

export type GithubRepoItem = {
  fullName: string;
  url: string;
};

export type GithubReposResponse = PublicGithubAccount & {
  repos: GithubRepoItem[];
};

export type GithubOAuthApi = {
  exchangeCode: (input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }) => Promise<{ accessToken: string; scope?: string }>;
  fetchUser: (token: string) => Promise<{ login: string }>;
  listRepos: (token: string) => Promise<Array<{ fullName: string; url: string }>>;
  revoke?: (input: { clientId: string; clientSecret: string; token: string }) => Promise<void>;
};

let api: GithubOAuthApi = defaultGithubOAuthApi();

export function setGithubOAuthApiForTest(next: GithubOAuthApi | null): void {
  api = next ?? defaultGithubOAuthApi();
}

export function githubOAuthConfig(env: NodeJS.ProcessEnv = process.env): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = (env.GITHUB_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GITHUB_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

export function githubOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(githubOAuthConfig(env));
}

export function resolvePublicOrigin(req?: IncomingMessage, env: NodeJS.ProcessEnv = process.env): string {
  const configured = publicAppUrl() || (env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }
  const proto =
    headerValue(req?.headers["x-forwarded-proto"])?.split(",")[0]?.trim() ||
    (req?.socket && "encrypted" in req.socket && req.socket.encrypted ? "https" : "http");
  const host =
    headerValue(req?.headers["x-forwarded-host"])?.split(",")[0]?.trim() ||
    headerValue(req?.headers.host) ||
    "127.0.0.1:8080";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function githubOAuthCallbackUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/v1/integrations/github/callback`;
}

export function settingsPageUrl(origin: string, error?: string): string {
  const base = `${origin.replace(/\/$/, "")}/#/settings`;
  return error ? `${base}?github=${encodeURIComponent(error)}` : base;
}

export async function publicGithubAccount(userId?: string | null): Promise<PublicGithubAccount> {
  const oauthConfigured = githubOAuthConfigured();
  if (!userId) {
    return { connected: false, login: null, oauthConfigured };
  }
  const conn = await getGithubConnection(userId);
  return {
    connected: Boolean(conn),
    login: conn?.login ?? null,
    oauthConfigured,
  };
}

export function createGithubAuthorizeUrl(userId: string, origin: string, env: NodeJS.ProcessEnv = process.env): string {
  const config = githubOAuthConfig(env);
  if (!config) {
    throw new Error("oauth_not_configured");
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: githubOAuthCallbackUri(origin),
    scope: GITHUB_OAUTH_SCOPES,
    state: signGithubOAuthState(userId),
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function signGithubOAuthState(userId: string, nowMs = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, e: nowMs + 10 * 60 * 1000, n: randomUUID() }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyGithubOAuthState(state: string, nowMs = Date.now()): string {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) {
    throw new Error("invalid_state");
  }
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(payload);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("invalid_state");
  }
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    u?: string;
    e?: number;
  };
  if (!claims.u || typeof claims.e !== "number" || claims.e < nowMs) {
    throw new Error("invalid_state");
  }
  return claims.u;
}

export async function completeGithubOAuthCallback(input: {
  code: string;
  state: string;
  userId: string;
  origin: string;
}): Promise<GithubConnection> {
  const config = githubOAuthConfig();
  if (!config) {
    throw new Error("oauth_not_configured");
  }
  const stateUser = verifyGithubOAuthState(input.state);
  if (stateUser !== input.userId) {
    throw new Error("state_user_mismatch");
  }
  const exchanged = await api.exchangeCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code: input.code,
    redirectUri: githubOAuthCallbackUri(input.origin),
  });
  const user = await api.fetchUser(exchanged.accessToken);
  const conn: GithubConnection = {
    userId: input.userId,
    login: user.login,
    accessToken: exchanged.accessToken,
    scopes: exchanged.scope || GITHUB_OAUTH_SCOPES,
    updatedAt: new Date().toISOString(),
  };
  await putGithubConnection(conn);
  return conn;
}

export async function disconnectGithubAccount(userId: string): Promise<PublicGithubAccount> {
  const conn = await getGithubConnection(userId);
  const config = githubOAuthConfig();
  if (conn && config && api.revoke) {
    try {
      await api.revoke({ clientId: config.clientId, clientSecret: config.clientSecret, token: conn.accessToken });
    } catch {
      // local disconnect still wins
    }
  }
  await deleteGithubConnection(userId);
  return publicGithubAccount(userId);
}

export async function listGithubRepos(userId: string, q = ""): Promise<GithubReposResponse> {
  const account = await publicGithubAccount(userId);
  if (!account.connected) {
    return { ...account, repos: [] };
  }
  const conn = await getGithubConnection(userId);
  if (!conn) {
    return { ...account, connected: false, login: null, repos: [] };
  }
  const repos = await api.listRepos(conn.accessToken);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? repos.filter((item) => item.fullName.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle))
    : repos;
  return {
    ...account,
    repos: filtered.slice(0, GITHUB_REPOS_LIMIT),
  };
}

function sign(payload: string): string {
  return createHmac("sha256", getConfig().jwtSecret).update(payload).digest("base64url");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function githubHeaders(token?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "neo-cloud-agent",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function defaultGithubOAuthApi(): GithubOAuthApi {
  return {
    async exchangeCode(input) {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      const body = (await response.json()) as {
        access_token?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };
      if (!response.ok || !body.access_token) {
        throw new Error(body.error_description || body.error || `github oauth token failed: ${response.status}`);
      }
      return { accessToken: body.access_token, scope: body.scope };
    },
    async fetchUser(token) {
      const response = await fetch("https://api.github.com/user", { headers: githubHeaders(token) });
      const body = (await response.json()) as { login?: string; message?: string };
      if (!response.ok || !body.login) {
        throw new Error(body.message ?? `github user failed: ${response.status}`);
      }
      return { login: body.login };
    },
    async listRepos(token) {
      const response = await fetch(
        "https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
        { headers: githubHeaders(token) },
      );
      const body = (await response.json()) as Array<{ full_name?: string; clone_url?: string; html_url?: string }> | {
        message?: string;
      };
      if (!response.ok || !Array.isArray(body)) {
        throw new Error((body as { message?: string }).message ?? `github repos failed: ${response.status}`);
      }
      return body
        .map((item) => {
          const fullName = (item.full_name ?? "").trim();
          const url = (item.clone_url || item.html_url || (fullName ? `https://github.com/${fullName}.git` : "")).trim();
          return fullName && url ? { fullName, url } : null;
        })
        .filter((item): item is GithubRepoItem => Boolean(item));
    },
    async revoke(input) {
      const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
      const response = await fetch(`https://api.github.com/applications/${input.clientId}/token`, {
        method: "DELETE",
        headers: {
          ...githubHeaders(),
          authorization: `Basic ${basic}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: input.token }),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`github revoke failed: ${response.status}`);
      }
    },
  };
}
