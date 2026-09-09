import assert from "node:assert/strict";
import test from "node:test";
import { loadLoopSession, saveLoopSession } from "./session-store.js";

test("loop session store round-trips a run session", () => {
  saveLoopSession("run-a", { messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(loadLoopSession("run-a"), { messages: [{ role: "user", content: "hi" }] });
});
