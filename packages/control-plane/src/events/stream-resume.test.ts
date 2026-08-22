import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { resumeAfter } from "./stream.js";

function req(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

test("SSE reconnect prefers Last-Event-ID over a stale after query", () => {
  const url = new URL("http://127.0.0.1/v1/runs/run-1/events?after=old-id");
  assert.equal(resumeAfter(req({ "last-event-id": "fresh-id" }), url), "fresh-id");
  assert.equal(resumeAfter(req({}), url), "old-id");
  assert.equal(resumeAfter(req({}), new URL("http://127.0.0.1/v1/runs/run-1/events")), null);
});
