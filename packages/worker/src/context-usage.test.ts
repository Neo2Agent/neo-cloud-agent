import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { inspectSessionContext } from "./context-usage.js";
import type { SessionContextSources } from "./session.js";

type StubTool = { name: string; description: string };

function stubSession(input: {
  tools: StubTool[];
  systemPrompt?: string;
  messages?: string[];
  summaries?: string[];
}): AgentSession {
  return {
    systemPrompt: input.systemPrompt ?? "system prompt",
    messages: (input.messages ?? []).map((text) => ({ role: "user", content: text })),
    model: { contextWindow: 1_000_000 },
    getContextUsage: () => undefined,
    getAllTools: () =>
      input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: { type: "object" },
        promptGuidelines: undefined,
      })),
    sessionManager: {
      getBranch: () => (input.summaries ?? []).map((summary) => ({ type: "compaction", summary })),
    },
  } as unknown as AgentSession;
}

function emptySources(overrides?: Partial<SessionContextSources>): SessionContextSources {
  return {
    resourceLoader: {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({ skills: [] }),
    },
    promptLayers: { base: "", boundary: "", expertRole: "", projectInstruction: "", userMemory: "" },
    ...overrides,
  } as SessionContextSources;
}

function tokensFor(session: AgentSession, sources?: SessionContextSources, id?: string): number {
  const usage = inspectSessionContext(session, { modelId: "deepseek-v4-flash", contextSources: sources });
  return usage.buckets.find((bucket) => bucket.id === id)?.tokens ?? 0;
}

test("tools split into builtin and cloud buckets", () => {
  const session = stubSession({
    tools: [
      { name: "read", description: "read a file" },
      { name: "neo_browse", description: "fetch a page" },
    ],
  });
  assert.ok(tokensFor(session, emptySources(), "tools") > 0);
  assert.ok(tokensFor(session, emptySources(), "cloudTools") > 0);
});

test("a tool from neither list lands in mcp instead of going missing", () => {
  const session = stubSession({
    tools: [{ name: "some_mcp_tool", description: "d".repeat(400) }],
  });
  const usage = inspectSessionContext(session, {
    modelId: "deepseek-v4-flash",
    contextSources: emptySources(),
  });
  const mcp = usage.buckets.find((bucket) => bucket.id === "mcp")?.tokens ?? 0;
  assert.ok(mcp > 0, "dynamically registered tools must be counted");
  assert.equal(usage.buckets.some((bucket) => bucket.id === "cloudTools"), false);
});

test("AGENTS.md and the neo rule layers land in the rules bucket", () => {
  const session = stubSession({ tools: [], systemPrompt: "s".repeat(2000) });
  const sources = emptySources({
    resourceLoader: {
      getAgentsFiles: () => ({ agentsFiles: [{ path: "/w/AGENTS.md", content: "x".repeat(600) }] }),
      getSkills: () => ({ skills: [] }),
    } as unknown as SessionContextSources["resourceLoader"],
    promptLayers: {
      base: "",
      boundary: "",
      expertRole: "expert role text",
      projectInstruction: "project instruction text",
      userMemory: "remembered fact",
    },
  });
  assert.ok(tokensFor(session, sources, "rules") > 0);
  assert.ok(tokensFor(session, sources, "memory") > 0);
});

test("the skills catalog is measured the way pi renders it", () => {
  const session = stubSession({ tools: [], systemPrompt: "s".repeat(2000) });
  const sources = emptySources({
    resourceLoader: {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({
        skills: [
          {
            name: "deploy",
            description: "Ship the app",
            filePath: "/w/.cursor/skills/deploy/SKILL.md",
            baseDir: "/w/.cursor/skills/deploy",
            disableModelInvocation: false,
          },
        ],
      }),
    } as unknown as SessionContextSources["resourceLoader"],
  });
  assert.ok(tokensFor(session, sources, "skills") > 0);
});

test("a broken resource loader degrades into system instead of throwing", () => {
  const session = stubSession({ tools: [], systemPrompt: "s".repeat(2000) });
  const sources = emptySources({
    resourceLoader: {
      getAgentsFiles: () => {
        throw new Error("loader is gone");
      },
      getSkills: () => {
        throw new Error("loader is gone");
      },
    } as unknown as SessionContextSources["resourceLoader"],
  });
  const usage = inspectSessionContext(session, { modelId: "deepseek-v4-flash", contextSources: sources });
  assert.equal(usage.buckets.some((bucket) => bucket.id === "rules"), false);
  assert.ok((usage.buckets.find((bucket) => bucket.id === "system")?.tokens ?? 0) > 0);
});

test("context usage still works before any session sources exist", () => {
  const session = stubSession({ tools: [{ name: "read", description: "read a file" }] });
  const usage = inspectSessionContext(session, { modelId: "deepseek-v4-flash" });
  assert.ok(usage.tokens > 0);
  assert.equal(usage.contextWindow, 1_000_000);
});
