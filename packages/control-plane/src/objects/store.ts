import { getConfig } from "../config.js";
import { createFsObjectStore } from "./fs.js";
import { createMemoryObjectStore } from "./memory.js";
import { createNoneObjectStore } from "./none.js";
import { createS3ObjectStore } from "./s3.js";

export type ObjectStoreKind = "fs" | "s3" | "memory" | "none";

export type ObjectStore = {
  kind: ObjectStoreKind;
  put(key: string, body: string, contentType?: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
};

let store: ObjectStore | null = null;

export function objectStoreKind(env: NodeJS.ProcessEnv = process.env): ObjectStoreKind {
  const raw = env.OBJECT_STORE?.trim();
  if (raw === "s3" || raw === "fs" || raw === "memory" || raw === "none") {
    return raw;
  }
  return "fs";
}

export function artifactKey(runId: string, name: string): string {
  const prefix = (getConfig().s3.prefix || "").replace(/^\/+|\/+$/g, "");
  const path = `runs/${runId}/${name}`;
  return prefix ? `${prefix}/${path}` : path;
}

export function createObjectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const kind = objectStoreKind(env);
  if (kind === "none") {
    return createNoneObjectStore();
  }
  if (kind === "memory") {
    return createMemoryObjectStore();
  }
  if (kind === "s3") {
    return createS3ObjectStore(getConfig().s3);
  }
  return createFsObjectStore(getConfig().runsDir);
}

export function getObjectStore(): ObjectStore {
  store ??= createObjectStoreFromEnv();
  return store;
}

export function setObjectStoreForTests(next: ObjectStore | null): void {
  store = next;
}
