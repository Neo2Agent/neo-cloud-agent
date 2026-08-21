import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { GitTokenScope } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { githubAppConfig, mintGithubInstallationToken } from "./github-app.js";

export type IssuedGitToken = {
  token: string;
  runId: string;
  repoUrl: string;
  scope: GitTokenScope;
  expiresAt: string;
  jti: string;
};

type TokenRecord = IssuedGitToken & { used: boolean };

const issued = new Map<string, TokenRecord>();

function secret(): string {
  return getConfig().jwtSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mintGitToken(input: {
  runId: string;
  repoUrl: string;
  scope: GitTokenScope;
  ttlMs?: number;
}): IssuedGitToken {
  const jti = randomUUID();
  const exp = Date.now() + (input.ttlMs ?? 30 * 60 * 1000);
  const body = Buffer.from(
    JSON.stringify({
      runId: input.runId,
      repoUrl: input.repoUrl,
      scope: input.scope,
      exp,
      jti,
    }),
  ).toString("base64url");
  const token = `neo.git.${body}.${sign(body)}`;
  const issuedToken: IssuedGitToken = {
    token,
    runId: input.runId,
    repoUrl: input.repoUrl,
    scope: input.scope,
    expiresAt: new Date(exp).toISOString(),
    jti,
  };
  issued.set(jti, { ...issuedToken, used: false });
  return issuedToken;
}

export function verifyGitToken(token: string, options?: { consume?: boolean }): IssuedGitToken {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "neo" || parts[1] !== "git") {
    throw new Error("invalid git token");
  }
  const body = parts[2] ?? "";
  const sig = parts[3] ?? "";
  const expected = sign(body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("invalid git token signature");
  }
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    runId: string;
    repoUrl: string;
    scope: GitTokenScope;
    exp: number;
    jti: string;
  };
  if (!claims.runId || !claims.jti || claims.exp < Date.now()) {
    throw new Error("git token expired");
  }
  const record = issued.get(claims.jti);
  if (!record) {
    throw new Error("git token is not recognized");
  }
  if (record.used) {
    throw new Error("git token already used");
  }
  if (options?.consume) {
    record.used = true;
  }
  return record;
}

export function scmPushToken(): string | null {
  return process.env.SCM_PUSH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

export async function resolveScmPushToken(): Promise<string | null> {
  const app = githubAppConfig();
  if (app) {
    try {
      const issued = await mintGithubInstallationToken(app);
      return issued.token;
    } catch (error) {
      if (!scmPushToken()) {
        throw error;
      }
    }
  }
  return scmPushToken();
}

export function resetGitTokens(): void {
  issued.clear();
}
