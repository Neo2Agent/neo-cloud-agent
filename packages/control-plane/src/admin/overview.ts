import type { PublicLlmSettings } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";
import { listPublicUsers } from "../accounts/accounts.js";
import type { PublicUser } from "../accounts/types.js";
import { listAutomations } from "../automations/store.js";
import { getConfig } from "../config.js";
import { listDesks } from "../desks/store.js";
import { listBuilds } from "../env/builds.js";
import { listEnvironments } from "../env/store.js";
import { platformInfo } from "../platform.js";
import { listProjects } from "../projects/store.js";
import { monthStartIso, quotaSnapshot, type QuotaSnapshot } from "../quota/quota.js";
import { isAdminLogin } from "../security/actor.js";
import { rateLimitEnabled, rateLimitStoreKind } from "../security/rate-limit.js";
import { summarizeVmSlots, type VmSlotSummary } from "../runtime/vm-slots.js";

const LIVE = new Set<Run["status"]>([
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

export type AdminUserRow = PublicUser & {
  admin: boolean;
  runCount: number;
  usedTokensMonth: number;
  concurrentRuns: number;
  lastActiveAt: string | null;
};

export type AdminRunRow = {
  id: string;
  status: Run["status"];
  prompt: string;
  userId: string;
  orgId: string;
  model: string;
  source: Run["source"];
  projectId: string | null;
  vmSlotId: string | null;
  createdAt: string;
  updatedAt: string;
  usage: Run["usage"];
};

export type AdminOverview = {
  users: { total: number; admins: number };
  runs: { total: number; live: number; byStatus: Record<string, number> };
  tokens: { usedMonth: number };
  quota: QuotaSnapshot;
  capacity: VmSlotSummary;
  rateLimit: { enabled: boolean; store: string };
  llm: PublicLlmSettings;
  newApi: { url: string | null; consoleUrl: string | null };
  platform: { metadataStore: string; eventBus: string; workerRuntime: string };
  counts: {
    automations: number;
    projects: number;
    builds: number;
    environments: number;
    desks: number;
  };
};

export function newApiInfo(): { url: string | null; consoleUrl: string | null } {
  const url = (process.env.NEW_API_URL ?? "").trim() || null;
  const consoleUrl = (process.env.NEW_API_CONSOLE_URL ?? "").trim() || null;
  return { url, consoleUrl };
}

export function adminRunsLimit(raw: string | null): number {
  const parsed = Number(raw ?? 100);
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  return Math.min(500, Math.max(1, Math.floor(parsed)));
}

export function buildAdminUserRows(users: PublicUser[], runs: Run[], now = new Date()): AdminUserRow[] {
  const start = monthStartIso(now);
  const byUser = new Map<string, { runCount: number; usedTokensMonth: number; concurrentRuns: number; lastActiveAt: string | null }>();
  for (const user of users) {
    byUser.set(user.id, { runCount: 0, usedTokensMonth: 0, concurrentRuns: 0, lastActiveAt: null });
  }
  for (const run of runs) {
    const stats = byUser.get(run.userId) ?? {
      runCount: 0,
      usedTokensMonth: 0,
      concurrentRuns: 0,
      lastActiveAt: null,
    };
    stats.runCount += 1;
    if (run.createdAt >= start) {
      stats.usedTokensMonth += run.usage?.totalTokens ?? 0;
    }
    if (LIVE.has(run.status)) {
      stats.concurrentRuns += 1;
    }
    if (!stats.lastActiveAt || run.updatedAt > stats.lastActiveAt) {
      stats.lastActiveAt = run.updatedAt;
    }
    byUser.set(run.userId, stats);
  }
  return users
    .map((user) => {
      const stats = byUser.get(user.id) ?? {
        runCount: 0,
        usedTokensMonth: 0,
        concurrentRuns: 0,
        lastActiveAt: null,
      };
      return {
        ...user,
        admin: isAdminLogin(user.email),
        ...stats,
      };
    })
    .sort(
      (left, right) =>
        right.concurrentRuns - left.concurrentRuns ||
        right.usedTokensMonth - left.usedTokensMonth ||
        right.runCount - left.runCount ||
        left.email.localeCompare(right.email),
    );
}

export function buildAdminRunRows(runs: Run[], limit = 100): AdminRunRow[] {
  return [...runs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((run) => ({
      id: run.id,
      status: run.status,
      prompt: run.prompt,
      userId: run.userId,
      orgId: run.orgId,
      model: run.model,
      source: run.source,
      projectId: run.projectId ?? null,
      vmSlotId: run.vmSlotId ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      usage: run.usage ?? null,
    }));
}

export function buildAdminOverview(input: {
  users: PublicUser[];
  runs: Run[];
  llm: PublicLlmSettings;
  orgId: string;
  workerRuntime: string;
}): AdminOverview {
  const byStatus: Record<string, number> = {};
  let live = 0;
  const start = monthStartIso();
  let usedMonth = 0;
  for (const run of input.runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    if (LIVE.has(run.status)) {
      live += 1;
    }
    if (run.createdAt >= start) {
      usedMonth += run.usage?.totalTokens ?? 0;
    }
  }
  const admins = input.users.filter((user) => isAdminLogin(user.email)).length;
  return {
    users: { total: input.users.length, admins },
    runs: { total: input.runs.length, live, byStatus },
    tokens: { usedMonth },
    quota: quotaSnapshot(input.runs, input.orgId),
    capacity: summarizeVmSlots(input.workerRuntime),
    rateLimit: { enabled: rateLimitEnabled(), store: rateLimitStoreKind() },
    llm: input.llm,
    newApi: newApiInfo(),
    platform: { ...platformInfo(), workerRuntime: input.workerRuntime },
    counts: {
      automations: listAutomations().length,
      projects: listProjects().length,
      builds: listBuilds().length,
      environments: listEnvironments().length,
      desks: listDesks().length,
    },
  };
}

export async function adminUsersPayload(runs: Run[]): Promise<{ users: AdminUserRow[] }> {
  return { users: buildAdminUserRows(await listPublicUsers(), runs) };
}

export async function adminOverviewPayload(runs: Run[], llm: PublicLlmSettings): Promise<AdminOverview> {
  const config = getConfig();
  return buildAdminOverview({
    users: await listPublicUsers(),
    runs,
    llm,
    orgId: config.orgId,
    workerRuntime: config.workerRuntime,
  });
}

export function adminRunsPayload(runs: Run[], limit: number): { runs: AdminRunRow[]; total: number } {
  return { runs: buildAdminRunRows(runs, limit), total: runs.length };
}
