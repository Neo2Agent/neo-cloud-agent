import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the remote loop keeps a tool-round cap past a short explore", () => {
  const source = readFileSync(new URL("./turn.ts", import.meta.url), "utf8");
  assert.match(source, /const MAX_ROUNDS = 32;/);
  assert.match(source, /工具回合过多/);
  assert.doesNotMatch(source, /const MAX_ROUNDS = 8;/);
});
