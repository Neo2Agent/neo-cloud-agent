import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColocatedTarget,
  colocatedTarget,
  isDeskTarget,
  parseExecutionTarget,
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
