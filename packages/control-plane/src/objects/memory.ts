import type { ObjectStore } from "./store.js";

export function createMemoryObjectStore(initial?: Record<string, string>): ObjectStore {
  const files = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    kind: "memory",
    async put(key, body) {
      files.set(key, body);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async list(prefix) {
      return [...files.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
  };
}
