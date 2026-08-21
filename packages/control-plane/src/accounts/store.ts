import { createFileAccountStore } from "./file.js";
import type { AccountStore } from "./types.js";

let store: AccountStore | null = null;

export function getAccountStore(): AccountStore {
  if (!store) {
    store = createFileAccountStore();
  }
  return store;
}

export function setAccountStore(next: AccountStore | null): void {
  store = next;
}
