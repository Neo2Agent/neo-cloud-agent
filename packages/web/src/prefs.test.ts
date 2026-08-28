import assert from "node:assert/strict";
import test from "node:test";
import { readLastRunId, readLastTarget, writeLastRunId, writeLastTarget } from "./prefs.js";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

test("last run id round-trips", () => {
  const storage = memory();
  assert.equal(readLastRunId(storage), null);
  writeLastRunId("run-1", storage);
  assert.equal(readLastRunId(storage), "run-1");
  writeLastRunId(null, storage);
  assert.equal(readLastRunId(storage), null);
});

test("last target remembers desk folder", () => {
  const storage = memory();
  writeLastTarget({ kind: "desk", folder: "/tmp/repo", deskId: "desk_1" }, storage);
  assert.deepEqual(readLastTarget(storage), { kind: "desk", folder: "/tmp/repo", deskId: "desk_1" });
});
