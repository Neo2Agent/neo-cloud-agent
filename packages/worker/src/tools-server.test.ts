import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import { ToolsServer } from "./tools-server.js";

function collect(root: string): { server: ToolsServer; frames: ToolsChannelFrame[] } {
  const frames: ToolsChannelFrame[] = [];
  const server = new ToolsServer({
    runId: "run-1",
    sandboxRoot: root,
    send: (frame) => frames.push(frame),
  });
  return { server, frames };
}

test("tools server writes and reads a file inside the sandbox", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-tools-"));
  const { server, frames } = collect(root);
  server.handle({
    v: 1,
    type: "fs.upload",
    callId: "u1",
    path: "README.md",
    bytesB64: Buffer.from("# hi\n").toString("base64"),
  });
  server.handle({ v: 1, type: "fs.download", callId: "d1", path: "README.md" });
  const ok = frames.find((item) => item.type === "ok" && item.callId === "d1");
  assert.ok(ok && ok.type === "ok");
  assert.equal(Buffer.from(ok.bytesB64 ?? "", "base64").toString(), "# hi\n");
});

test("tools server refuses a path escape", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-tools-"));
  const { server, frames } = collect(root);
  server.handle({ v: 1, type: "fs.download", callId: "x1", path: "../secret" });
  const err = frames.find((item) => item.type === "err");
  assert.ok(err && err.type === "err");
  assert.equal(err.code, "escaped");
});

test("tools server streams exec stdout and ends", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-tools-"));
  writeFileSync(path.join(root, "a.txt"), "ok\n");
  const { server, frames } = collect(root);
  server.handle({ v: 1, type: "exec", callId: "e1", command: "cat a.txt", timeoutMs: 5000 });
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (frames.some((item) => item.type === "exec.end")) {
        resolve();
        return;
      }
      if (Date.now() - started > 4000) {
        reject(new Error("exec did not finish"));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
  assert.ok(frames.some((item) => item.type === "exec.stdout" && item.type === "exec.stdout" && item.text.includes("ok")));
  const end = frames.find((item) => item.type === "exec.end");
  assert.ok(end && end.type === "exec.end");
  assert.equal(end.exitCode, 0);
});

test("tools server aborts a running command", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-tools-"));
  const { server, frames } = collect(root);
  server.handle({ v: 1, type: "exec", callId: "sleep1", command: "sleep 30", timeoutMs: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.handle({ v: 1, type: "abort", callId: "sleep1" });
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (frames.some((item) => item.type === "exec.end")) {
        resolve();
        return;
      }
      if (Date.now() - started > 4000) {
        reject(new Error("abort did not end exec"));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
  const end = frames.find((item) => item.type === "exec.end");
  assert.ok(end && end.type === "exec.end");
  assert.notEqual(end.exitCode, 0);
});
