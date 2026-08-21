import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import {
  accumulateAssistant,
  CLI_PROTOCOL,
  createFormatter,
  mapStreamEvent,
  resultFrom,
} from "./format.js";
import type { CliIo } from "./io.js";

function event(kind: RunEvent["kind"], data?: Record<string, unknown>): RunEvent {
  return {
    id: kind,
    runId: "run-1",
    createdAt: "2026-08-21T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind,
    title: kind,
    data,
  };
}

function memoryIo(): { io: CliIo; out: string; err: string } {
  let out = "";
  let err = "";
  const io: CliIo = {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    stdin: process.stdin,
    env: {},
    cwd: "/tmp",
    now: () => 0,
    isStdoutTty: false,
    isStdinTty: true,
    homedir: () => "/tmp",
  };
  return {
    io,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

test("accumulateAssistant joins deltas", () => {
  const text = accumulateAssistant([
    event("message.delta", { delta: "Hel" }),
    event("tool.start", { toolName: "bash" }),
    event("message.delta", { delta: "lo" }),
  ]);
  assert.equal(text, "Hello");
});

test("mapStreamEvent keeps the print protocol narrow", () => {
  assert.deepEqual(mapStreamEvent(event("message.delta", { delta: "x" })), {
    type: "assistant",
    text: "x",
    delta: true,
  });
  assert.equal(mapStreamEvent(event("tool.start", { toolName: "bash" })).type, "tool");
  assert.equal(mapStreamEvent(event("run.idle")).type, "event");
});

test("json format prints one result object and hides failures from stdout", () => {
  const ok = memoryIo();
  const good = createFormatter("json", ok.io);
  good.init({ id: "r1", model: "neo/deepseek", status: "RUNNING" });
  good.event(event("message.delta", { delta: "hi" }));
  const code = good.finish(
    resultFrom({
      subtype: "success",
      run: { id: "r1", status: "IDLE" },
      durationMs: 10,
      result: "hi",
      eventCount: 1,
    }),
  );
  assert.equal(code, 0);
  const body = JSON.parse(ok.out) as { protocol: string; run_id: string };
  assert.equal(body.protocol, CLI_PROTOCOL);
  assert.equal(body.run_id, "r1");

  const bad = memoryIo();
  const fail = createFormatter("json", bad.io);
  const failed = fail.finish(
    resultFrom({
      subtype: "error",
      run: { id: "r1", status: "ERROR" },
      durationMs: 10,
      result: "boom",
      eventCount: 0,
      error: "boom",
    }),
  );
  assert.equal(failed, 1);
  assert.equal(bad.out, "");
  assert.match(bad.err, /boom/);
});

test("stream-json writes init, events, and result", () => {
  const sink = memoryIo();
  const formatter = createFormatter("stream-json", sink.io);
  formatter.init({ id: "r1", model: "neo/deepseek", status: "RUNNING" });
  formatter.event(event("message.delta", { delta: "A" }));
  formatter.finish(
    resultFrom({
      subtype: "success",
      run: { id: "r1", status: "IDLE" },
      durationMs: 3,
      result: "A",
      eventCount: 1,
    }),
  );
  const lines = sink.out.trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(lines[0]?.type, "system");
  assert.equal(lines[1]?.type, "assistant");
  assert.equal(lines[2]?.type, "result");
});
