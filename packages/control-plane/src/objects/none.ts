import type { ObjectStore } from "./store.js";

export function createNoneObjectStore(): ObjectStore {
  return {
    kind: "none",
    async put() {},
    async get() {
      return null;
    },
    async list() {
      return [];
    },
  };
}
