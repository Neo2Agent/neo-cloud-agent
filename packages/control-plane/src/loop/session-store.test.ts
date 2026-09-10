import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRedis } from "../events/redis.js";
import {
  attachLoopSessionBackends,
  dropLoopSessionMemoryForTest,
  loadLoopSession,
  loopSessionStoreKind,
  resetLoopSessionsForTest,
  saveLoopSession,
} from "./session-store.js";

test("loop session store round-trips a run session", async () => {
  resetLoopSessionsForTest();
  await saveLoopSession("run-a", { messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(await loadLoopSession("run-a"), { messages: [{ role: "user", content: "hi" }] });
});

test("loop session store hydrates from redis then sql after memory miss", async () => {
  resetLoopSessionsForTest();
  const redis = createMemoryRedis();
  const sql = new Map<string, Record<string, unknown>>();
  attachLoopSessionBackends({
    redis,
    sql: {
      async saveLoopSession(runId, _userId, state) {
        sql.set(runId, state);
      },
      async loadLoopSession(runId) {
        return sql.get(runId) ?? null;
      },
    },
  });
  assert.equal(loopSessionStoreKind(), "redis+sql");
  await saveLoopSession("run-b", { messages: [{ role: "user", content: "persisted" }] }, { userId: "user_1" });
  dropLoopSessionMemoryForTest();
  assert.deepEqual(await loadLoopSession("run-b"), { messages: [{ role: "user", content: "persisted" }] });

  await redis.set("loop:session:run-b", "");
  dropLoopSessionMemoryForTest();
  attachLoopSessionBackends({
    redis: null,
    sql: {
      async saveLoopSession() {
        /* unused */
      },
      async loadLoopSession(runId) {
        return sql.get(runId) ?? null;
      },
    },
  });
  assert.deepEqual(await loadLoopSession("run-b"), { messages: [{ role: "user", content: "persisted" }] });
});
