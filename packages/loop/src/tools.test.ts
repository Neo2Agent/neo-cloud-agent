import assert from "node:assert/strict";
import test from "node:test";
import type { ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import type { ToolCallResult } from "./hub.js";
import { runTool, type ToolCaller } from "./tools.js";

function fakeHub(text = "alpha beta"): ToolCaller & { frames: ToolsChannelFrame[] } {
  const frames: ToolsChannelFrame[] = [];
  return {
    frames,
    call(_runId: string, frame: ToolsChannelFrame): Promise<ToolCallResult> {
      frames.push(frame);
      if (frame.type === "fs.download") {
        return Promise.resolve({ ok: true, text, stdout: "" });
      }
      if (frame.type === "fs.list") {
        return Promise.resolve({ ok: true, text: "note.txt", stdout: "" });
      }
      if (frame.type === "exec" || frame.type === "fs.upload") {
        return Promise.resolve({ ok: true, text: "ok", stdout: "ok" });
      }
      return Promise.resolve({ ok: false, text: "unexpected", stdout: "" });
    },
  };
}

test("file and shell tools use channel frames and never send /workspace as cwd", async () => {
  const hub = fakeHub();
  assert.equal(await runTool(hub, "run", "read", { path: "note.txt" }), "alpha beta");
  assert.equal(await runTool(hub, "run", "ls", { path: "." }), "note.txt");
  assert.equal(await runTool(hub, "run", "write", { path: "out.txt", contents: "hi" }), "ok");
  assert.equal(
    await runTool(hub, "run", "edit", { path: "note.txt", old_string: "alpha", new_string: "gamma" }),
    "edited note.txt",
  );
  assert.equal(await runTool(hub, "run", "bash", { command: "pwd" }), "ok");
  assert.equal(await runTool(hub, "run", "grep", { pattern: "alpha", path: "." }), "ok");
  assert.equal(await runTool(hub, "run", "find", { pattern: "*.txt", path: "." }), "ok");

  const execs = hub.frames.filter((frame) => frame.type === "exec");
  assert.equal(execs.length, 3);
  assert.equal(execs.some((frame) => "cwd" in frame), false);
  const uploads = hub.frames.filter((frame) => frame.type === "fs.upload");
  const edited = uploads.at(-1);
  assert.ok(edited && edited.type === "fs.upload");
  assert.equal(Buffer.from(edited.bytesB64, "base64").toString("utf8"), "gamma beta");
});
