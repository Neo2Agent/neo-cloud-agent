import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { attachHotBus, ingestRemoteEvent, listEvents, publish, resetHistory, subscribe } from "./bus.js";
import { createMemoryRedis, parseHotEvent, runChannel, runStreamKey } from "./redis.js";

function event(id: string, runId = "run-hot-1"): RunEvent {
  return {
    id,
    runId,
    createdAt: "2026-08-21T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "message.delta",
    title: id,
  };
}

test("memory redis fans a live event to another subscriber and keeps a hot tail", async () => {
  const redis = createMemoryRedis();
  const received: string[] = [];
  const stop = await redis.pSubscribe("neo:run:*", (message, channel) => {
    received.push(`${channel}:${parseHotEvent(message)?.id}`);
  });
  await redis.xAdd(runStreamKey("run-hot-1"), JSON.stringify(event("a")));
  await redis.publish(runChannel("run-hot-1"), JSON.stringify(event("a")));
  assert.deepEqual(received, ["neo:run:run-hot-1:a"]);
  assert.equal((await redis.xRange(runStreamKey("run-hot-1"))).length, 1);
  await stop();
});

test("remote ingest does not duplicate an event this process already published", () => {
  resetHistory();
  const seen: string[] = [];
  const off = subscribe("run-hot-2", (item) => seen.push(item.id));
  attachHotBus({
    publish(item) {
      ingestRemoteEvent(item);
    },
  });
  publish(event("local-1", "run-hot-2"), { persist: false });
  assert.deepEqual(seen, ["local-1"]);
  assert.equal(ingestRemoteEvent(event("local-1", "run-hot-2")), false);
  assert.equal(ingestRemoteEvent(event("remote-2", "run-hot-2")), true);
  assert.deepEqual(
    listEvents("run-hot-2").map((item) => item.id),
    ["local-1", "remote-2"],
  );
  off();
  attachHotBus(null);
  resetHistory();
});
