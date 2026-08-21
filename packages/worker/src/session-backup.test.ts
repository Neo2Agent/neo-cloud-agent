import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectSessionFiles } from "./session-backup.js";

test("collectSessionFiles copies jsonl and skips auth.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-"));
  mkdirSync(path.join(dir, "agent"), { recursive: true });
  writeFileSync(path.join(dir, "agent", "auth.json"), "{\"apiKey\":\"secret\"}");
  writeFileSync(path.join(dir, "agent", "turn.jsonl"), "{\"type\":\"message\"}\n");
  const files = collectSessionFiles(dir);
  assert.equal(files.some((file) => file.name.endsWith("turn.jsonl")), true);
  assert.equal(files.some((file) => file.name.endsWith("auth.json")), false);
});
