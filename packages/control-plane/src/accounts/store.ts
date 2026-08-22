import { createFileAccountStore } from "./file.js";
import type { AccountStore } from "./types.js";

export type AccountStoreKind = "file" | "mysql" | "postgres";

let store: AccountStore | null = null;
let storeKind: AccountStoreKind = "file";

export function getAccountStore(): AccountStore {
  if (!store) {
    store = createFileAccountStore();
    storeKind = "file";
  }
  return store;
}

export function accountStoreKind(): AccountStoreKind {
  getAccountStore();
  return storeKind;
}

export function setAccountStore(next: AccountStore | null, kind: AccountStoreKind = "file"): void {
  store = next;
  storeKind = next ? kind : "file";
}
