import assert from "node:assert/strict";
import test from "node:test";
import { decodeUtf8Preview } from "./artifact-text.js";

test("decodeUtf8Preview reads Chinese and rejects invalid bytes", () => {
  assert.equal(decodeUtf8Preview(new TextEncoder().encode("中文 Markdown")), "中文 Markdown");
  assert.throws(() => decodeUtf8Preview(Uint8Array.from([0xff, 0xfe, 0xfd])));
});
