import assert from "node:assert/strict";
import test from "node:test";
import { parseTermSseData } from "./workspace-term.js";

test("parseTermSseData accepts shell events and ignores junk", () => {
  assert.equal(parseTermSseData("not-json"), null);
  assert.equal(parseTermSseData(JSON.stringify({ type: "ping" })), null);
  assert.equal(parseTermSseData(JSON.stringify({ type: "data", chunk: "ls\n" }))?.type, "data");
  assert.equal(parseTermSseData(JSON.stringify({ type: "exit", code: 0 }))?.type, "exit");
});
