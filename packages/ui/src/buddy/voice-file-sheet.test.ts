import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "voice-file-sheet.tsx"), "utf8");

test("HTTP voice sheet tells the user to pick a recording, not video", () => {
  assert.match(src, /选一段录音/);
  assert.match(src, /选录音文件/);
  assert.match(src, /不要点「录像」或相册/);
});
