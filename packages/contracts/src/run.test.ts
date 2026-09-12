import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColocatedTarget,
  assertExecutionTarget,
  colocatedTarget,
  isCloudLoopTarget,
  isDeskTarget,
  isDeskToolsTarget,
  isRemoteControlTarget,
  parseExecutionTarget,
  resolveRunKernel,
  parseRunSource,
  parseRunStart,
} from "./run.js";

test("parseExecutionTarget accepts the two-axis shape", () => {
  assert.deepEqual(parseExecutionTarget({ loop: "cloud", tools: "cloud" }), {
    loop: "cloud",
    tools: "cloud",
    deskId: undefined,
    deskWorkspaceId: undefined,
  });
  assert.deepEqual(parseExecutionTarget({ loop: "desk", tools: "desk", deskId: "desk_1" }), {
    loop: "desk",
    tools: "desk",
    deskId: "desk_1",
    deskWorkspaceId: undefined,
  });
  assert.deepEqual(
    parseExecutionTarget({ loop: "desk", tools: "desk", deskId: "desk_1", deskWorkspaceId: " dws_9 " }),
    { loop: "desk", tools: "desk", deskId: "desk_1", deskWorkspaceId: "dws_9" },
  );
  assert.equal(parseExecutionTarget({ loop: "cloud" }), undefined);
  assert.equal(parseExecutionTarget(null), undefined);
  assert.deepEqual(
    parseExecutionTarget({ loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: true }),
    { loop: "desk", tools: "desk", deskId: "desk_1", deskWorkspaceId: undefined, remoteControl: true },
  );
  assert.equal(
    parseExecutionTarget({ loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: false })?.remoteControl,
    undefined,
  );
  assert.equal(
    parseExecutionTarget({ loop: "cloud", tools: "cloud", remoteControl: true })?.remoteControl,
    undefined,
  );
});

test("isRemoteControlTarget is cloud-loop + desk-tools, not This Computer", () => {
  assert.equal(isRemoteControlTarget({ loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: true }), false);
  assert.equal(isRemoteControlTarget({ loop: "desk", tools: "desk", deskId: "desk_1" }), false);
  assert.equal(isRemoteControlTarget({ loop: "cloud", tools: "cloud" }), false);
  assert.equal(
    isRemoteControlTarget({ loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true }),
    true,
  );
  assert.deepEqual(parseExecutionTarget({ loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true }), {
    loop: "cloud",
    tools: "desk",
    deskId: "desk_1",
    deskWorkspaceId: undefined,
    remoteControl: true,
  });
});

test("parseRunStart only accepts the two start modes", () => {
  assert.equal(parseRunStart("inline"), "inline");
  assert.equal(parseRunStart("dispatch"), "dispatch");
  assert.equal(parseRunStart("later"), undefined);
  assert.equal(parseRunStart(undefined), undefined);
});

test("parseRunSource accepts mobile hosts", () => {
  assert.equal(parseRunSource("ios"), "ios");
  assert.equal(parseRunSource("android"), "android");
  assert.equal(parseRunSource("web"), "web");
  assert.equal(parseRunSource("phone"), undefined);
});

test("P0–P2 reject a split loop/tools target", () => {
  assert.equal(isDeskTarget(colocatedTarget("cloud")), false);
  assert.equal(isDeskTarget(colocatedTarget("desk", "desk_1")), true);
  assert.throws(() => assertColocatedTarget({ loop: "cloud", tools: "desk", deskId: "desk_1" }), /同址/);
  assert.throws(() => assertColocatedTarget({ loop: "desk", tools: "desk" }), /deskId/);
});

test("agentscope kernel allows cloud loop + desk tools", () => {
  const split = { loop: "cloud" as const, tools: "desk" as const, deskId: "desk_1" };
  assert.equal(isDeskToolsTarget(split), true);
  assert.equal(isCloudLoopTarget(split), true);
  assert.equal(isDeskTarget(split), false);
  assertExecutionTarget(split, "agentscope");
  assert.throws(() => assertExecutionTarget(split, "pi"), /同址/);
  assert.throws(
    () => assertExecutionTarget({ loop: "desk", tools: "cloud" }, "agentscope"),
    /本机 loop/,
  );
});

test("resolveRunKernel follows Cursor: This Computer stays pi, Cloud/Remote prefer agentscope", () => {
  assert.equal(resolveRunKernel({ kernel: "pi", target: { loop: "cloud", tools: "cloud" } }), "pi");
  assert.equal(
    resolveRunKernel({
      kernel: "agentscope",
      target: { loop: "desk", tools: "desk", deskId: "desk_1" },
    }),
    "agentscope",
  );
  assert.equal(
    resolveRunKernel({ target: { loop: "desk", tools: "desk", deskId: "desk_1" } }, { AGENT_KERNEL: "agentscope" }),
    "pi",
  );
  assert.equal(
    resolveRunKernel({
      target: { loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true },
    }),
    "agentscope",
  );
  assert.equal(resolveRunKernel({ target: { loop: "cloud", tools: "cloud" } }), "pi");
  assert.equal(
    resolveRunKernel({ target: { loop: "cloud", tools: "cloud" } }, { NEO_LOOP_AVAILABLE: "1" }),
    "agentscope",
  );
  assert.equal(
    resolveRunKernel({ target: { loop: "cloud", tools: "cloud" } }, { AGENT_KERNEL: "agentscope" }),
    "agentscope",
  );
});
