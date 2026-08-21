import assert from "node:assert/strict";
import test from "node:test";
import { parseSseChunk } from "./sse.js";

test("parseSseChunk splits frames and ignores pings", () => {
  const { frames, rest } = parseSseChunk(
    [
      ": ping",
      "",
      "id: e1",
      "data: {\"kind\":\"run.idle\"}",
      "",
      "id: e2",
      "data: {\"kind\":\"message.delta\"}",
      "",
      "id: partial",
    ].join("\n"),
  );
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.id, "e1");
  assert.equal(rest, "id: partial");
});
