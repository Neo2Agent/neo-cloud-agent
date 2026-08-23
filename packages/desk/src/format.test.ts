import assert from "node:assert/strict";
import test from "node:test";
import { toolArgPreview } from "./format.js";

test("toolArgPreview prefers bash command and path", () => {
  assert.equal(toolArgPreview({ command: "ls -la" }), "ls -la");
  assert.equal(toolArgPreview({ path: "src/app.ts" }), "src/app.ts");
  assert.equal(toolArgPreview({ agent: "scout", task: "look around" }), "scout: look around");
});
