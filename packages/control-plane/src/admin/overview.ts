import { readNewApiInfo, type PublicLlmSettings } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";
import { findPublicUserById, listPublicUsers } from "../accounts/accounts.js";
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
  title?: string | null;
  userId: string;
  userEmail?: string | null;
  orgId: string;
  model: string;
  source: Run["source"];
  projectId: string | null;
  vmSlotId: string | null;
  expertId?: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
  usage: Run["usage"];
};

export type AdminRunDetail = AdminRunRow & {
  setupStatus: Run["setupStatus"];
  expertTeamId: string | null;
  kernel: string | null;
  repoUrls: string[];
  branchName: string | null;
  pullRequests: Array<{ url: string; title: string; draft: boolean }>;
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
  /** Newest live conversations so the homepage does not also fetch /runs. */
  liveRuns: AdminRunRow[];
};

export function newApiInfo(): { url: string | null; consoleUrl: string | null } {
  return readNewApiInfo();
}

export function adminRunsLimit(raw: string | null): number {
  const parsed = Number(raw ?? 100);
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  return Math.min(500, Math.max(1, Math.floor(parsed)));
}

export function isLiveRunStatus(status: string): boolean {
  return LIVE.has(status as Run["status"]);
}

export function userEmailMap(users: PublicUser[]): Map<string, string> {
  return new Map(users.map((user) => [user.id, user.email]));
}

export function filterRunsForAdmin(runs: Run[], userId?: string | null): Run[] {
  const id = userId?.trim();
  if (!id) {
    return runs;
  }
  return runs.filter((run) => run.userId === id);
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

function toAdminRunRow(run: Run, emails?: Map<string, string>): AdminRunRow {
  return {
    id: run.id,
    status: run.status,
    prompt: run.prompt,
    title: run.title ?? null,
    userId: run.userId,
    userEmail: emails?.get(run.userId) ?? null,
    orgId: run.orgId,
    model: run.model,
    source: run.source,
    projectId: run.projectId ?? null,
    vmSlotId: run.vmSlotId ?? null,
    expertId: run.expertId ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage ?? null,
    usage: run.usage ?? null,
  };
}

export function buildAdminRunRows(runs: Run[], limit = 100, emails?: Map<string, string>): AdminRunRow[] {
  return [...runs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((run) => toAdminRunRow(run, emails));
}

export function buildAdminRunDetail(run: Run, emails?: Map<string, string>): AdminRunDetail {
  return {
    ...toAdminRunRow(run, emails),
    setupStatus: run.setupStatus ?? null,
    expertTeamId: run.expertTeamId ?? null,
    kernel: run.kernel ?? null,
    repoUrls: run.repoUrls ?? [],
    branchName: run.branchName ?? null,
    pullRequests: (run.pullRequests ?? []).map((item) => ({
      url: item.url,
      title: item.title,
      draft: Boolean(item.draft),
    })),
  };
}

export function buildAdminOverview(input: {
  users: PublicUser[];
  runs: Run[];
  llm: PublicLlmSettings;
  orgId: string;
  workerRuntime: string;
  platform?: { metadataStore: string; eventBus: string };
  counts?: AdminOverview["counts"];
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
  const emails = userEmailMap(input.users);
  return {
    users: { total: input.users.length, admins },
    runs: { total: input.runs.length, live, byStatus },
    tokens: { usedMonth },
    quota: quotaSnapshot(input.runs, input.orgId),
    capacity: summarizeVmSlots(input.workerRuntime),
    rateLimit: { enabled: rateLimitEnabled(), store: rateLimitStoreKind() },
    llm: input.llm,
    newApi: newApiInfo(),
    platform: { ...(input.platform ?? platformInfo()), workerRuntime: input.workerRuntime },
    counts: input.counts ?? {
      automations: listAutomations().length,
      projects: listProjects().length,
      builds: listBuilds().length,
      environments: listEnvironments().length,
      desks: listDesks().length,
    },
    liveRuns: buildAdminRunRows(
      input.runs.filter((run) => LIVE.has(run.status)),
      8,
      emails,
    ),
  };
}

export async function adminUsersPayload(runs: Run[]): Promise<{ users: AdminUserRow[] }> {
  return { users: buildAdminUserRows(await listPublicUsers(), runs) };
}

export async function adminOverviewPayload(
  runs: Run[],
  llm: PublicLlmSettings,
  extras?: { platform?: { metadataStore: string; eventBus: string }; counts?: AdminOverview["counts"] },
): Promise<AdminOverview> {
  const config = getConfig();
  return buildAdminOverview({
    users: await listPublicUsers(),
    runs,
    llm,
    orgId: config.orgId,
    workerRuntime: config.workerRuntime,
    platform: extras?.platform,
    counts: extras?.counts,
  });
}

export function adminRunsPayload(
  runs: Run[],
  limit: number,
  options?: { userId?: string | null; users?: PublicUser[] },
): { runs: AdminRunRow[]; total: number } {
  const scoped = filterRunsForAdmin(runs, options?.userId);
  return {
    runs: buildAdminRunRows(scoped, limit, options?.users ? userEmailMap(options.users) : undefined),
    total: scoped.length,
  };
}

export async function adminRunDetailPayload(run: Run): Promise<{ run: AdminRunDetail }> {
  const owner = await findPublicUserById(run.userId);
  const emails = owner ? new Map([[owner.id, owner.email]]) : undefined;
  return { run: buildAdminRunDetail(run, emails) };
}

export async function adminUserDetailPayload(
  user: PublicUser,
  runs: Run[],
): Promise<{ user: AdminUserRow; runs: AdminRunRow[] }> {
  const row = buildAdminUserRows([user], runs)[0];
  if (!row) {
    throw new Error("user_row_missing");
  }
  return {
    user: row,
    runs: buildAdminRunRows(
      filterRunsForAdmin(runs, user.id),
      50,
      new Map([[user.id, user.email]]),
    ),
  };
}
