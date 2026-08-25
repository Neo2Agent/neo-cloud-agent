import type { Run } from "@neo-cloud-agent/contracts";
import { ensureDefaultAdmin } from "../../control-plane/src/accounts/accounts.js";
import { setAccountStore } from "../../control-plane/src/accounts/store.js";
import { connectRedis } from "../../control-plane/src/events/redis.js";
import { attachRateLimitRedis } from "../../control-plane/src/security/rate-limit.js";
import { connectDatabase, type DatabaseKind, type MetadataStore } from "../../control-plane/src/store/database.js";
import { loadPersistedRuns } from "../../control-plane/src/store/persist.js";
import { listAutomations } from "../../control-plane/src/automations/store.js";
import { listDesks } from "../../control-plane/src/desks/store.js";
import { listBuilds } from "../../control-plane/src/env/builds.js";
import { listEnvironments } from "../../control-plane/src/env/store.js";
import { listProjects } from "../../control-plane/src/projects/store.js";

let metadata: MetadataStore | null = null;
let metadataKind: "fs" | DatabaseKind = "fs";
let eventBus: "memory" | "redis" = "memory";
let started: Promise<void> | null = null;

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
  if (metadata) {
    const records = await metadata.loadRuns();
    return records.map((record) => record.run);
  }
  return loadPersistedRuns().map((record) => record.run);
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
