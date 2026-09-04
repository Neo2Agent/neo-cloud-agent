import assert from "node:assert/strict";
import test from "node:test";
import { defaultAgentKernel, parseAgentKernel, parseWorkerRole, resolveAgentKernel } from "./kernel.js";

test("parseAgentKernel only accepts pi or agentscope", () => {
  assert.equal(parseAgentKernel("pi"), "pi");
  assert.equal(parseAgentKernel("agentscope"), "agentscope");
  assert.equal(parseAgentKernel("java"), undefined);
});

test("default kernel is pi unless AGENT_KERNEL is set", () => {
  assert.equal(defaultAgentKernel({}), "pi");
  assert.equal(defaultAgentKernel({ AGENT_KERNEL: "agentscope" }), "agentscope");
  assert.equal(resolveAgentKernel(undefined, {}), "pi");
  assert.equal(resolveAgentKernel("agentscope", { AGENT_KERNEL: "pi" }), "agentscope");
});

test("parseWorkerRole defaults to all", () => {
  assert.equal(parseWorkerRole("tools"), "tools");
  assert.equal(parseWorkerRole("all"), "all");
  assert.equal(parseWorkerRole("loop"), undefined);
});
