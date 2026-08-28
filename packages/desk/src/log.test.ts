import assert from "node:assert/strict";
import test from "node:test";
import { formatError, formatFields, formatLine } from "./log.js";

test("a line carries its scope and named fields", () => {
  assert.equal(
    formatLine("local-run", "worker spawned", { runId: "run_a", pid: 4321 }),
    "[desk:local-run] worker spawned runId=run_a pid=4321",
  );
});

test("empty fields are dropped instead of printed as undefined", () => {
  assert.equal(formatFields({ runId: "run_a", folder: undefined, note: "", code: null }), " runId=run_a");
  assert.equal(formatFields(), "");
  assert.equal(formatFields({}), "");
});

test("a value with spaces is quoted so the fields stay parseable", () => {
  assert.equal(formatFields({ folder: "/Users/me/my repo" }), ' folder="/Users/me/my repo"');
});

test("an error keeps both its message and its stack", () => {
  const detail = formatError(new Error("claim refused"));
  assert.match(detail, /^claim refused/);
  assert.match(detail, /log\.test\.ts/);
});

test("a thrown non-error still prints something", () => {
  assert.equal(formatError("boom"), "boom");
  assert.equal(formatError(undefined), "");
});
