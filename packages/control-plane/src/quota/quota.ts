import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveLlmSettingsRoot } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";

const FILE_NAME = path.join(".neo", "quota.env");

const LIVE = new Set<Run["status"]>([
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

export class QuotaError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export type QuotaLimits = {
  maxTokensMonth: number;
  maxConcurrentRuns: number;
};

export type QuotaSnapshot = QuotaLimits & {
  usedTokensMonth: number;
  concurrentRuns: number;
  remainingTokens: number | null;
  remainingConcurrent: number | null;
};

function quotaFile(root = resolveLlmSettingsRoot()): string {
  return path.join(root, FILE_NAME);
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function asLimit(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function readQuotaLimits(): QuotaLimits {
  let stored: Record<string, string> = {};
  try {
    stored = parseEnv(readFileSync(quotaFile(), "utf8"));
  } catch {
    stored = {};
  }
  return {
    maxTokensMonth: asLimit(process.env.QUOTA_MAX_TOKENS_MONTH ?? stored.QUOTA_MAX_TOKENS_MONTH),
    maxConcurrentRuns: asLimit(process.env.QUOTA_MAX_CONCURRENT_RUNS ?? stored.QUOTA_MAX_CONCURRENT_RUNS),
  };
}

export function writeQuotaLimits(input: Partial<QuotaLimits>): QuotaLimits {
  const current = readQuotaLimits();
  const next = {
    QUOTA_MAX_TOKENS_MONTH: String(input.maxTokensMonth ?? current.maxTokensMonth),
    QUOTA_MAX_CONCURRENT_RUNS: String(input.maxConcurrentRuns ?? current.maxConcurrentRuns),
  };
  const file = quotaFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    `# Written by Neo Cloud Agent. 0 means unlimited.\nQUOTA_MAX_TOKENS_MONTH=${next.QUOTA_MAX_TOKENS_MONTH}\nQUOTA_MAX_CONCURRENT_RUNS=${next.QUOTA_MAX_CONCURRENT_RUNS}\n`,
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  return readQuotaLimits();
}

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function usedTokensThisMonth(runs: Run[], orgId: string, now = new Date()): number {
  const start = monthStartIso(now);
  return runs
    .filter((run) => run.orgId === orgId && run.createdAt >= start)
    .reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
}

export function concurrentRunsForOrg(runs: Run[], orgId: string): number {
  return runs.filter((run) => run.orgId === orgId && LIVE.has(run.status)).length;
}

export function quotaSnapshot(runs: Run[], orgId: string): QuotaSnapshot {
  const limits = readQuotaLimits();
  const usedTokensMonth = usedTokensThisMonth(runs, orgId);
  const concurrentRuns = concurrentRunsForOrg(runs, orgId);
  return {
    ...limits,
    usedTokensMonth,
    concurrentRuns,
    remainingTokens: limits.maxTokensMonth > 0 ? Math.max(0, limits.maxTokensMonth - usedTokensMonth) : null,
    remainingConcurrent: limits.maxConcurrentRuns > 0 ? Math.max(0, limits.maxConcurrentRuns - concurrentRuns) : null,
  };
}

export function assertCreateRunAllowed(runs: Run[], orgId: string): QuotaSnapshot {
  const snapshot = quotaSnapshot(runs, orgId);
  if (snapshot.maxConcurrentRuns > 0 && snapshot.concurrentRuns >= snapshot.maxConcurrentRuns) {
    throw new QuotaError(`quota: concurrent runs ${snapshot.concurrentRuns}/${snapshot.maxConcurrentRuns}`);
  }
  if (snapshot.maxTokensMonth > 0 && snapshot.usedTokensMonth >= snapshot.maxTokensMonth) {
    throw new QuotaError(`quota: monthly tokens ${snapshot.usedTokensMonth}/${snapshot.maxTokensMonth}`);
  }
  return snapshot;
}
