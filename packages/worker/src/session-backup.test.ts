import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectSessionFiles, restoreSessionFiles } from "./session-backup.js";

test("collectSessionFiles copies jsonl and skips auth.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-"));
  mkdirSync(path.join(dir, "agent"), { recursive: true });
  writeFileSync(path.join(dir, "agent", "auth.json"), "{\"apiKey\":\"secret\"}");
  writeFileSync(path.join(dir, "agent", "turn.jsonl"), "{\"type\":\"message\"}\n");
  const files = collectSessionFiles(dir);
  assert.equal(files.some((file) => file.name === "agent/turn.jsonl"), true);
  assert.equal(files.some((file) => file.name.endsWith("auth.json")), false);
});

test("restoreSessionFiles writes nested jsonl and rejects escapes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-restore-"));
  const restored = restoreSessionFiles(dir, [
    { name: "agent/turn.jsonl", content: "{\"type\":\"message\"}\n" },
    { name: "../escape.jsonl", content: "nope" },
    { name: "agent/auth.json", content: "{\"apiKey\":\"secret\"}" },
  ]);
  assert.deepEqual(
    restored.map((file) => file.name),
    ["agent/turn.jsonl"],
  );
  assert.equal(readFileSync(path.join(dir, "agent", "turn.jsonl"), "utf8"), "{\"type\":\"message\"}\n");
  assert.equal(existsSync(path.join(dir, "agent", "auth.json")), false);
  assert.equal(existsSync(path.join(dir, "..", "escape.jsonl")), false);
});
