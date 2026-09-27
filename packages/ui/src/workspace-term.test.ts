import assert from "node:assert/strict";
import test from "node:test";
import { parseTermSseData } from "./workspace-term.ts";

test("parseTermSseData keeps ready data and exit", () => {
  assert.deepEqual(parseTermSseData(JSON.stringify({ type: "data", chunk: "hi" })), { type: "data", chunk: "hi" });
  assert.equal(parseTermSseData("not-json"), null);
  assert.equal(parseTermSseData(JSON.stringify({ type: "other" })), null);
});
