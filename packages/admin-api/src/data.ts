import {
  buildTranscriptSnapshot,
  pageTranscriptSnapshot,
  slimTranscriptSnapshotImages,
  transcriptHasUnsettledWork,
  type Run,
  type TranscriptSnapshot,
} from "@neo-cloud-agent/contracts";
import { ensureDefaultAdmin } from "../../control-plane/src/accounts/accounts.js";
import { setAccountStore } from "../../control-plane/src/accounts/store.js";
import { compactHotEvents } from "../../control-plane/src/events/history.js";
import { connectRedis } from "../../control-plane/src/events/redis.js";
import { attachRateLimitRedis } from "../../control-plane/src/security/rate-limit.js";
import { connectDatabase, type DatabaseKind, type MetadataStore } from "../../control-plane/src/store/database.js";
import {
  loadPersistedEvents,
  loadPersistedRun,
  loadPersistedRuns,
  loadTranscriptSnapshot,
  peekLastPersistedEventId,
} from "../../control-plane/src/store/persist.js";
import { listAutomations } from "../../control-plane/src/automations/store.js";
import { listDesks } from "../../control-plane/src/desks/store.js";
import { listBuilds } from "../../control-plane/src/env/builds.js";
import { listEnvironments } from "../../control-plane/src/env/store.js";
import { listProjects } from "../../control-plane/src/projects/store.js";
import { readBundledExpertPolicy, replaceBundledExpertPolicy } from "../../control-plane/src/experts/policy.js";
import { setBundledExpertPolicyPersistHooks } from "../../control-plane/src/experts/policy-persist.js";

let metadata: MetadataStore | null = null;
let metadataKind: "fs" | DatabaseKind = "fs";
let eventBus: "memory" | "redis" = "memory";
let started: Promise<void> | null = null;
let runsCache: { at: number; runs: Run[] } | null = null;
const RUNS_CACHE_MS = process.env.NODE_TEST_CONTEXT ? 0 : 4000;

export function adminPlatformInfo() {
  return {
    metadataStore: metadataKind,
    eventBus,
  };
}

export async function startAdminData(): Promise<void> {
  started ??= doStart();
  return started;
}

async function doStart(): Promise<void> {
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  const redisUrl = (process.env.REDIS_URL ?? "").trim();
  if (databaseUrl) {
    const connected = await connectDatabase(databaseUrl);
    metadata = connected.store;
    metadataKind = connected.kind;
    setAccountStore(connected.store, connected.kind);
    setBundledExpertPolicyPersistHooks({
      onWrite: (doc) => {
        void connected.store.saveExpertPolicy(doc).catch((error) => console.error("admin-api saveExpertPolicy failed", error));
      },
    });
    const remote = await connected.store.loadExpertPolicy();
    if (remote) {
      replaceBundledExpertPolicy(remote, { mirror: false });
    } else {
      const local = readBundledExpertPolicy();
      if (Object.keys(local.experts).length > 0) {
        await connected.store.saveExpertPolicy(local);
      }
    }
  }
  if (redisUrl) {
    attachRateLimitRedis(await connectRedis(redisUrl));
    eventBus = "redis";
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    await ensureDefaultAdmin().catch((error) => {
      console.error("admin-api default admin failed", error);
    });
  }
}

export async function loadAdminRuns(): Promise<Run[]> {
  if (runsCache && Date.now() - runsCache.at < RUNS_CACHE_MS) {
    return runsCache.runs;
  }
  const runs = metadata
    ? (await metadata.loadRunSummaries()).filter((run) => !run.deletedAt)
    : loadPersistedRuns()
        .map((record) => record.run)
        .filter((run) => !run.deletedAt);
  runsCache = { at: Date.now(), runs };
  return runs;
}

export async function loadAdminRun(runId: string): Promise<Run | null> {
  const id = runId.trim();
  if (!id) {
    return null;
  }
  const record = metadata ? await metadata.loadRun(id) : loadPersistedRun(id);
  const run = record?.run;
  if (!run || run.deletedAt) {
    return null;
  }
  return run;
}

function withPageMeta(snapshot: TranscriptSnapshot): TranscriptSnapshot {
  return {
    ...snapshot,
    remaining: snapshot.remaining ?? 0,
    nextBefore: snapshot.nextBefore ?? null,
    total: snapshot.total ?? snapshot.messages.length,
  };
}

export async function loadAdminTranscript(runId: string): Promise<TranscriptSnapshot | null> {
  const run = await loadAdminRun(runId);
  if (!run) {
    return null;
  }
  if (metadata) {
    const events = await metadata.loadEvents(runId);
    if (events.length > 0) {
      return buildTranscriptSnapshot(runId, compactHotEvents(events));
    }
  }
  const lastId = peekLastPersistedEventId(runId);
  const cached = loadTranscriptSnapshot(runId);
  if (cached && cached.lastEventId === lastId && !transcriptHasUnsettledWork(cached.messages)) {
    return withPageMeta(cached);
  }
  const events = loadPersistedEvents(runId);
  if (events.length === 0) {
    return cached
      ? withPageMeta(cached)
      : {
          runId,
          seq: 0,
          lastEventId: null,
          messages: [],
          remaining: 0,
          nextBefore: null,
          total: 0,
        };
  }
  return buildTranscriptSnapshot(runId, compactHotEvents(events));
}

export function pageAdminTranscript(
  snapshot: TranscriptSnapshot,
  query: { before?: string | null; limit?: string | null },
): TranscriptSnapshot {
  const limit = query.limit ? Number(query.limit) : undefined;
  return slimTranscriptSnapshotImages(
    pageTranscriptSnapshot(snapshot, {
      before: query.before,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  );
}

export async function loadAdminCounts() {
  if (metadata) {
    const [automations, projects, builds, environments, desks] = await Promise.all([
      metadata.loadAutomations(),
      metadata.loadProjects(),
      metadata.loadBuilds(),
      metadata.loadEnvironments(),
      metadata.loadDesks(),
    ]);
    return {
      automations: automations.length,
      projects: projects.length,
      builds: builds.length,
      environments: environments.length,
      desks: desks.length,
    };
  }
  return {
    automations: listAutomations().length,
    projects: listProjects().length,
    builds: listBuilds().length,
    environments: listEnvironments().length,
    desks: listDesks().length,
  };
}
