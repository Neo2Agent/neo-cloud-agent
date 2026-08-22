import { ensureDefaultAdmin } from "./accounts/accounts.js";
import { setAccountStore } from "./accounts/store.js";
import { importBuild, listBuilds } from "./env/builds.js";
import { setEnvPersistHooks } from "./env/persist-hooks.js";
import { listEnvironments, upsertEnvironment } from "./env/store.js";
import { attachHotBus, ingestRemoteEvent } from "./events/bus.js";
import { connectRedis, parseHotEvent, runChannel, runStreamKey, type RedisHotClient } from "./events/redis.js";
import { reloadPersistedState } from "./orchestrator/orchestrator.js";
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
  attachHotBus(null);
}

async function doStart(): Promise<void> {
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
