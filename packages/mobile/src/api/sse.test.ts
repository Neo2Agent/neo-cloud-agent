import assert from "node:assert/strict";
import test from "node:test";
import { consumeSseBuffer, parseSseChunk, parseSseData } from "./sse.js";
import { detectMobileSource, parseRunIdFromHref } from "./source.js";

test("parseSseChunk keeps Last-Event-ID frames", () => {
  const parsed = parseSseChunk("id: e1\ndata: {\"id\":\"e1\",\"kind\":\"run.idle\"}\n\nrest");
  assert.equal(parsed.frames[0]?.id, "e1");
  assert.equal(parseSseData(parsed.frames[0]?.data ?? "")?.kind, "run.idle");
  assert.equal(parsed.rest, "rest");
});

test("consumeSseBuffer yields complete events and keeps a partial frame", () => {
  const first = consumeSseBuffer<{ id?: string; kind?: string }>(
    'id: e1\ndata: {"id":"e1","kind":"message.delta"}\n\nid: e2\ndata: {"id":"e2"',
  );
  assert.equal(first.events[0]?.kind, "message.delta");
  assert.match(first.rest, /e2/);
});

test("mobile source and deep links", () => {
  assert.equal(detectMobileSource("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "ios");
  assert.equal(detectMobileSource("Mozilla/5.0 (Linux; Android 14)"), "android");
  assert.equal(parseRunIdFromHref("https://host/#/runs/abc-1"), "abc-1");
  assert.equal(parseRunIdFromHref("neo://runs/abc-1"), "abc-1");
});
