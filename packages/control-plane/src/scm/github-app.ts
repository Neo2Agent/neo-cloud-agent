import { createSign } from "node:crypto";

export type GithubAppConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
};

export type InstallationToken = {
  token: string;
  expiresAt: string;
};

export type GithubAppApi = {
  createInstallationToken: (jwt: string, installationId: string) => Promise<InstallationToken>;
};

let cached: { token: string; expiresAtMs: number } | null = null;
let api: GithubAppApi = defaultGithubAppApi();

export function githubAppConfig(env: NodeJS.ProcessEnv = process.env): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = normalizePem(env.GITHUB_APP_PRIVATE_KEY ?? "");
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  if (!appId || !privateKey || !installationId) {
    return null;
  }
  return { appId, privateKey, installationId };
}

export function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return decoded.includes("BEGIN") ? decoded : "";
  } catch {
    return "";
  }
}

export function mintGithubAppJwt(appId: string, privateKey: string, nowMs = Date.now()): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: Math.floor(nowMs / 1000) - 60,
      exp: Math.floor(nowMs / 1000) + 9 * 60,
      iss: appId,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

function defaultGithubAppApi(): GithubAppApi {
  return {
    async createInstallationToken(jwt, installationId) {
      const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "x-github-api-version": "2022-11-28",
        },
      });
      const body = (await response.json()) as { token?: string; expires_at?: string; message?: string };
      if (!response.ok || !body.token || !body.expires_at) {
        throw new Error(body.message ?? `github app token failed: ${response.status}`);
      }
      return { token: body.token, expiresAt: body.expires_at };
    },
  };
}

export function setGithubAppApiForTests(next: GithubAppApi | null): void {
  api = next ?? defaultGithubAppApi();
  cached = null;
}

export function resetGithubAppTokenCache(): void {
  cached = null;
}

export async function mintGithubInstallationToken(
  config: GithubAppConfig,
  nowMs = Date.now(),
): Promise<InstallationToken> {
  if (cached && cached.expiresAtMs - nowMs > 2 * 60 * 1000) {
    return { token: cached.token, expiresAt: new Date(cached.expiresAtMs).toISOString() };
  }
  const jwt = mintGithubAppJwt(config.appId, config.privateKey, nowMs);
  const issued = await api.createInstallationToken(jwt, config.installationId);
  cached = { token: issued.token, expiresAtMs: Date.parse(issued.expiresAt) };
  return issued;
}
