import assert from "node:assert/strict";
import test from "node:test";
import { defaultAgentKernel, parseAgentKernel, parseWorkerRole, resolveAgentKernel } from "./kernel.js";

test("parseAgentKernel only accepts pi or agentscope", () => {
  assert.equal(parseAgentKernel("pi"), "pi");
  assert.equal(parseAgentKernel("agentscope"), "agentscope");
  assert.equal(parseAgentKernel("java"), undefined);
});

test("default kernel is agentscope unless AGENT_KERNEL is pi", () => {
  assert.equal(defaultAgentKernel({}), "agentscope");
  assert.equal(defaultAgentKernel({ AGENT_KERNEL: "pi" }), "pi");
  assert.equal(resolveAgentKernel(undefined, {}), "agentscope");
  assert.equal(resolveAgentKernel("pi", { AGENT_KERNEL: "agentscope" }), "pi");
  assert.equal(resolveAgentKernel("agentscope", { AGENT_KERNEL: "pi" }), "agentscope");
});

test("parseWorkerRole defaults to all", () => {
  assert.equal(parseWorkerRole("tools"), "tools");
  assert.equal(parseWorkerRole("all"), "all");
  assert.equal(parseWorkerRole("loop"), undefined);
});
