import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChainPlaceholder,
  formatSubagentResult,
  mergeSubagentDefinitions,
  parseAgentMarkdown,
  parseSubagentRequest,
  parseToolList,
  resolveSubagent,
} from "./subagent.js";

test("parseAgentMarkdown reads pi-style frontmatter", () => {
  const parsed = parseAgentMarkdown(`---
name: auditor
description: Security review
tools: read, grep, find, ls
model: inherit
---

Look for secrets.
`);
  assert.equal(parsed?.name, "auditor");
  assert.equal(parsed?.description, "Security review");
  assert.deepEqual(parsed?.tools, ["read", "grep", "find", "ls"]);
  assert.equal(parsed?.systemPrompt, "Look for secrets.");
});

test("parseToolList accepts csv and arrays", () => {
  assert.deepEqual(parseToolList("read, bash"), ["read", "bash"]);
  assert.deepEqual(parseToolList(["read", "bash"]), ["read", "bash"]);
  assert.equal(parseToolList(12), undefined);
});

test("parseSubagentRequest accepts the official pi modes", () => {
  assert.deepEqual(parseSubagentRequest({ agent: "scout", task: "find auth" }), {
    mode: "single",
    tasks: [{ agent: "scout", task: "find auth" }],
  });
  const parallel = parseSubagentRequest({
    tasks: [
      { agent: "scout", task: "models" },
      { agent: "planner", task: "cli" },
    ],
  });
  assert.equal("mode" in parallel && parallel.mode, "parallel");
  const chain = parseSubagentRequest({
    chain: [
      { agent: "scout", task: "find" },
      { agent: "planner", task: "plan using {previous}" },
    ],
  });
  assert.equal("mode" in chain && chain.mode, "chain");
  assert.match((parseSubagentRequest({ agent: "scout", tasks: [] }) as { error: string }).error, /exactly one mode/);
});

test("project agents override bundled names", () => {
  const agents = mergeSubagentDefinitions([
    {
      name: "scout",
      description: "local scout",
      systemPrompt: "custom",
      source: "project",
    },
  ]);
  assert.equal(resolveSubagent(agents, "scout")?.systemPrompt, "custom");
  assert.ok(resolveSubagent(agents, "worker"));
});

test("chain placeholder and result formatting", () => {
  assert.equal(applyChainPlaceholder("use:\n{previous}", "FOUND"), "use:\nFOUND");
  assert.match(
    formatSubagentResult({
      mode: "parallel",
      results: [
        { agent: "scout", content: "a" },
        { agent: "planner", content: "b" },
      ],
    }),
    /1\. scout[\s\S]*2\. planner/,
  );
});
