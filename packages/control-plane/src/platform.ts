import { ensureDefaultAdmin } from "./accounts/accounts.js";
import { setAccountStore } from "./accounts/store.js";
import { importBuild, listBuilds } from "./env/builds.js";
import { setEnvPersistHooks } from "./env/persist-hooks.js";
import { claimOrphanAutomations } from "./automations/claim.js";
import { listAutomations, replaceAutomations } from "./automations/store.js";
import { setAutomationPersistHooks } from "./automations/persist-hooks.js";
import { listProjects, replaceProjects } from "./projects/store.js";
import { setProjectPersistHooks } from "./projects/persist-hooks.js";
import { listDesks, replaceDesks } from "./desks/store.js";
import { setDeskPersistHooks } from "./desks/persist-hooks.js";
import { listStoredDevices, replaceDevices } from "./devices/store.js";
import { setDevicePersistHooks } from "./devices/persist-hooks.js";
import { listEnvironments, upsertEnvironment } from "./env/store.js";
import { attachHotBus, ingestRemoteEvent } from "./events/bus.js";
import { connectRedis, parseHotEvent, runChannel, runStreamKey, type RedisHotClient } from "./events/redis.js";
import { reloadPersistedState } from "./orchestrator/orchestrator.js";
import { ensureGitHubWebhookSecret } from "./subscriptions/secret.js";
import { connectDatabase, type DatabaseKind, type MetadataStore } from "./store/database.js";
import { persistRunRecord, persistWorkerLease, replacePersistedEvents, setPersistHooks } from "./store/persist.js";

let started: Promise<void> | null = null;
let metadata: MetadataStore | null = null;
let redis: RedisHotClient | null = null;
let metadataKind: "fs" | DatabaseKind = "fs";
let eventBusKind: "memory" | "redis" = "memory";

export function platformInfo() {
  return {
    metadataStore: metadataKind,
    eventBus: eventBusKind,
  };
}

export function getPostgresStore(): MetadataStore | null {
  return metadata;
}

export function getMetadataStore(): MetadataStore | null {
  return metadata;
}

export function getRedisClient(): RedisHotClient | null {
  return redis;
}

export async function startPlatform(): Promise<void> {
  started ??= doStart();
  return started;
}

export function resetPlatformForTests(): void {
  started = null;
  metadata = null;
  redis = null;
  metadataKind = "fs";
  eventBusKind = "memory";
  setPersistHooks({});
  setEnvPersistHooks({});
  setAutomationPersistHooks({});
  setProjectPersistHooks({});
  setDeskPersistHooks({});
  setDevicePersistHooks({});
  attachHotBus(null);
}

async function doStart(): Promise<void> {
  ensureGitHubWebhookSecret();
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  const redisUrl = (process.env.REDIS_URL ?? "").trim();
  if (databaseUrl) {
    const connected = await connectDatabase(databaseUrl);
    metadata = connected.store;
    metadataKind = connected.kind;
    setAccountStore(metadata, connected.kind);
    setPersistHooks({
      onRun: (record) => {
        void metadata?.saveRun(record).catch((error) => console.error("metadata saveRun failed", error));
      },
      onEvent: (event) => {
        void metadata?.saveEvent(event).catch((error) => console.error("metadata saveEvent failed", error));
      },
      onLease: (lease) => {
        void metadata?.saveLease(lease).catch((error) => console.error("metadata saveLease failed", error));
      },
      onDeleteLease: (runId) => {
        void metadata?.deleteLease(runId).catch((error) => console.error("metadata deleteLease failed", error));
      },
    });
    setAutomationPersistHooks({
      onWrite: (items) => {
        void mirrorAutomations(metadata, items).catch((error) => console.error("metadata saveAutomation failed", error));
      },
    });
    setProjectPersistHooks({
      onWrite: (items) => {
        void mirrorProjects(metadata, items).catch((error) => console.error("metadata saveProject failed", error));
      },
    });
    setDeskPersistHooks({
      onWrite: (items) => {
        void mirrorDesks(metadata, items).catch((error) => console.error("metadata saveDesk failed", error));
      },
    });
    setDevicePersistHooks({
      onWrite: (items) => {
        void mirrorDevices(metadata, items).catch((error) => console.error("metadata saveDevice failed", error));
      },
    });
    setEnvPersistHooks({
      onEnvironment: (env) => {
        void metadata?.saveEnvironment(env).catch((error) => console.error("metadata saveEnvironment failed", error));
      },
      onBuild: (build) => {
        void metadata?.saveBuild(build).catch((error) => console.error("metadata saveBuild failed", error));
      },
    });
    await hydrateFromStore(metadata);
    await hydrateEnvFromStore(metadata);
    await hydrateAutomationsFromStore(metadata);
    await hydrateProjectsFromStore(metadata);
    await hydrateDesksFromStore(metadata);
    await hydrateDevicesFromStore(metadata);
    reloadPersistedState();
    console.log(`control-plane metadata store: ${metadataKind}`);
  }
  if (redisUrl) {
    redis = await connectRedis(redisUrl);
    eventBusKind = "redis";
    attachHotBus({
      publish(event) {
        const payload = JSON.stringify(event);
        void redis?.xAdd(runStreamKey(event.runId), payload).catch((error) => console.error("redis xadd failed", error));
        void redis?.publish(runChannel(event.runId), payload).catch((error) => console.error("redis publish failed", error));
      },
    });
    await redis.pSubscribe("neo:run:*", (message) => {
      const event = parseHotEvent(message);
      if (event) {
        ingestRemoteEvent(event);
      }
    });
    console.log("control-plane event bus: redis");
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    await ensureDefaultAdmin().catch((error) => {
      console.error("default admin account failed", error);
    });
    await claimOrphanAutomations().catch((error) => {
      console.error("claim orphan automations failed", error);
    });
  }
}

async function hydrateFromStore(store: MetadataStore): Promise<void> {
  const records = await store.loadRuns();
  for (const record of records) {
    persistRunRecord(record, undefined, { mirror: false });
    const events = await store.loadEvents(record.run.id);
    if (events.length > 0) {
      replacePersistedEvents(record.run.id, events);
    }
    const lease = await store.loadLease(record.run.id);
    if (lease) {
      persistWorkerLease(lease, undefined, { mirror: false });
    }
  }
}

async function hydrateEnvFromStore(store: MetadataStore): Promise<void> {
  const remoteEnvs = await store.loadEnvironments();
  if (remoteEnvs.length > 0) {
    for (const env of remoteEnvs) {
      upsertEnvironment(env, { mirror: false });
    }
  } else {
    for (const env of listEnvironments()) {
      await store.saveEnvironment(env);
    }
  }
  const remoteBuilds = await store.loadBuilds();
  if (remoteBuilds.length > 0) {
    for (const build of remoteBuilds) {
      importBuild(build);
    }
  } else {
    for (const build of listBuilds()) {
      await store.saveBuild(build);
    }
  }
}

async function hydrateAutomationsFromStore(store: MetadataStore): Promise<void> {
  const remote = await store.loadAutomations();
  if (remote.length > 0) {
    replaceAutomations(remote, { mirror: false });
    return;
  }
  for (const item of listAutomations()) {
    await store.saveAutomation(item);
  }
}

async function hydrateDesksFromStore(store: MetadataStore): Promise<void> {
  const local = listDesks();
  if (local.length > 0) {
    for (const item of local) {
      await store.saveDesk(item);
    }
    return;
  }
  const remote = await store.loadDesks();
  if (remote.length > 0) {
    replaceDesks(remote, { mirror: false });
  }
}

async function hydrateDevicesFromStore(store: MetadataStore): Promise<void> {
  const local = listStoredDevices();
  if (local.length > 0) {
    for (const item of local) {
      await store.saveDevice(item);
    }
    return;
  }
  const remote = await store.loadDevices();
  if (remote.length > 0) {
    replaceDevices(remote, { mirror: false });
  }
}

async function mirrorDevices(store: MetadataStore | null, items: import("@neo-cloud-agent/contracts").Device[]): Promise<void> {
  if (!store) {
    return;
  }
  const remote = await store.loadDevices();
  const keep = new Set(items.map((item) => item.id));
  for (const item of items) {
    await store.saveDevice(item);
  }
  for (const old of remote) {
    if (!keep.has(old.id)) {
      await store.deleteDevice(old.id);
    }
  }
}

async function mirrorDesks(store: MetadataStore | null, items: import("@neo-cloud-agent/contracts").Desk[]): Promise<void> {
  if (!store) {
    return;
  }
  const remote = await store.loadDesks();
  const keep = new Set(items.map((item) => item.id));
  for (const item of items) {
    await store.saveDesk(item);
  }
  for (const old of remote) {
    if (!keep.has(old.id)) {
      await store.deleteDesk(old.id);
    }
  }
}

async function hydrateProjectsFromStore(store: MetadataStore): Promise<void> {
  const remote = await store.loadProjects();
  if (remote.length > 0) {
    replaceProjects(remote, { mirror: false });
    return;
  }
  for (const item of listProjects()) {
    await store.saveProject(item);
  }
}

async function mirrorProjects(store: MetadataStore | null, items: import("@neo-cloud-agent/contracts").Project[]): Promise<void> {
  if (!store) {
    return;
  }
  const remote = await store.loadProjects();
  const keep = new Set(items.map((item) => item.id));
  for (const item of items) {
    await store.saveProject(item);
  }
  for (const old of remote) {
    if (!keep.has(old.id)) {
      await store.deleteProject(old.id);
    }
  }
}

async function mirrorAutomations(store: MetadataStore | null, items: import("@neo-cloud-agent/contracts").Automation[]): Promise<void> {
  if (!store) {
    return;
  }
  const remote = await store.loadAutomations();
  const keep = new Set(items.map((item) => item.id));
  for (const item of items) {
    await store.saveAutomation(item);
  }
  for (const old of remote) {
    if (!keep.has(old.id)) {
      await store.deleteAutomation(old.id);
    }
  }
}
