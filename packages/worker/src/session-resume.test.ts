import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findResumableSessionFile, resumeOrCreateSessionManager } from "./session-resume.js";

function writePiSession(dir: string, cwd: string, user: string, assistant: string): string {
  const id = "11111111-2222-3333-4444-555555555555";
  const userId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const assistantId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const timestamp = "2026-08-29T12:00:00.000Z";
  const file = path.join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  const ms = Date.parse(timestamp);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "session", version: 3, id, timestamp, cwd }),
      JSON.stringify({
        type: "message",
        id: userId,
        parentId: null,
        timestamp,
        message: { role: "user", content: [{ type: "text", text: user }], timestamp: ms },
      }),
      JSON.stringify({
        type: "message",
        id: assistantId,
        parentId: userId,
        timestamp,
        message: { role: "assistant", content: [{ type: "text", text: assistant }], timestamp: ms },
      }),
    ].join("\n") + "\n",
  );
  return file;
}

test("findResumableSessionFile skips jsonl that is not a pi session", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-find-"));
  mkdirSync(path.join(dir, "agent"), { recursive: true });
  writeFileSync(path.join(dir, "agent", "turn.jsonl"), "{\"type\":\"message\"}\n");
  assert.equal(findResumableSessionFile(dir), null);
});

test("resume opens the restored session even when the slot cwd changed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-resume-"));
  const file = writePiSession(dir, "/mnt/old-slot/workspace", "郑州天气", "明天 23–27°C");
  assert.equal(findResumableSessionFile(dir), file);

  const opened = resumeOrCreateSessionManager("/mnt/new-slot/workspace", dir);
  assert.equal(opened.resumed, true);
  assert.equal(opened.file, file);
  assert.equal(opened.manager.getCwd(), "/mnt/new-slot/workspace");
  assert.equal(opened.manager.getSessionFile(), file);
  const roles = opened.manager
    .getEntries()
    .filter((entry) => entry.type === "message")
    .map((entry) => ("message" in entry ? (entry.message as { role?: string }).role : undefined));
  assert.deepEqual(roles, ["user", "assistant"]);
});

test("resumeOrCreateSessionManager creates a new session when nothing is restored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-sess-new-"));
  const opened = resumeOrCreateSessionManager("/workspace", dir);
  assert.equal(opened.resumed, false);
  assert.equal(opened.file, null);
  assert.equal(opened.manager.getCwd(), "/workspace");
});
