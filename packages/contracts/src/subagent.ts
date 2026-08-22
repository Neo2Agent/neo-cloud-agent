export const SUBAGENT_TOOL_NAME = "neo_subagent";

export const BUNDLED_SUBAGENT_NAMES = ["scout", "planner", "reviewer", "worker"] as const;

export type BundledSubagentName = (typeof BUNDLED_SUBAGENT_NAMES)[number];

export type SubagentSource = "bundled" | "project";

export type SubagentMode = "single" | "parallel" | "chain";

export interface SubagentDefinition {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: SubagentSource;
  filePath?: string;
}

export interface SubagentTask {
  agent: string;
  task: string;
}

export interface ParsedSubagentRequest {
  mode: SubagentMode;
  tasks: SubagentTask[];
}

export const MAX_SUBAGENT_TASKS = 8;
export const MAX_SUBAGENT_CONCURRENCY = 2;
export const MAX_SUBAGENT_STEPS = 40;
export const SUBAGENT_TIMEOUT_MS = 120_000;

export type SubagentStep = {
  id: string;
  name: string;
  agent: string;
  subagentId?: string;
  status: "running" | "done";
  isError?: boolean;
  args?: unknown;
  output?: string;
};

export function isNestedSubagentEvent(data?: Record<string, unknown> | null): boolean {
  return Boolean(
    (typeof data?.subagent === "string" && data.subagent) ||
      (typeof data?.subagentId === "string" && data.subagentId),
  );
}

export function isSubagentStep(value: unknown): value is SubagentStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.agent === "string";
}

export function readSubagentSteps(details?: Record<string, unknown>): SubagentStep[] {
  const raw = details?.steps;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isSubagentStep);
}

export function seedSubagentDetails(
  args: unknown,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const base = { ...(existing ?? {}) };
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return base;
  }
  const parsed = parseSubagentRequest(args as Record<string, unknown>);
  if ("error" in parsed) {
    return base;
  }
  return {
    ...base,
    mode: parsed.mode,
    agents: parsed.tasks.map((item) => item.agent),
    tasks: parsed.tasks,
  };
}

export const BUNDLED_SUBAGENTS: SubagentDefinition[] = [
  {
    name: "scout",
    description: "Fast codebase recon that returns compressed context for another agent",
    tools: ["read", "grep", "find", "ls", "neo_browse"],
    source: "bundled",
    systemPrompt: `You are a scout. Investigate the workspace or a public page and return structured findings another agent can use without re-reading everything.

Thoroughness (infer from the task, default medium):
- Quick: targeted lookups, key files or 1-2 pages
- Medium: follow imports, read critical sections, or a few high-signal pages
- Thorough: trace dependencies, check tests, or a short set of sources

Strategy:
1. Workspace: grep/find/ls, then read key sections — not entire files
2. Public web: use neo_browse only. Never curl, wget, or other HTTP via a shell
3. Fetch a few high-signal pages, then stop. Do not loop

Output:
## Files Retrieved
1. \`path/file.ts\` (lines 10-50) - what is here

## Sources
- title — url — one-line takeaway

## Key Code
Short excerpts only.

## Architecture
How the pieces connect.

## Start Here
Which file or source to open first and why.`,
  },
  {
    name: "planner",
    description: "Read-only implementation plans from context and requirements",
    tools: ["read", "grep", "find", "ls"],
    source: "bundled",
    systemPrompt: `You are a planning specialist. You receive scout findings and requirements, then produce a concrete plan.

Do not modify files. Only read, analyze, and plan.

Output:
## Goal
One sentence.

## Plan
Numbered, small, actionable steps with file paths.

## Files to Modify
- \`path/file.ts\` - what changes

## New Files (if any)

## Risks
Anything the worker must watch for.`,
  },
  {
    name: "reviewer",
    description: "Read-only code review for quality, correctness, and security",
    tools: ["read", "grep", "find", "ls", "bash"],
    source: "bundled",
    systemPrompt: `You are a senior reviewer. Analyze quality, correctness, and security.

Bash is read-only only: git diff, git log, git show. Do not modify files or run builds.

Output:
## Files Reviewed
## Critical (must fix)
## Warnings (should fix)
## Suggestions
## Summary
Be specific with paths and line numbers.`,
  },
  {
    name: "worker",
    description: "General-purpose subagent with full capabilities and isolated context",
    source: "bundled",
    systemPrompt: `You are a worker agent with the same workspace tools as the parent, minus nested subagents.

Complete the assigned task autonomously. Do not ask the parent to do work you can do.

Output:
## Completed
## Files Changed
## Notes
If handing off to a reviewer, include exact paths and key symbols.`,
  },
];

export function parseToolList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tools = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/^\[|\]$/g, "").trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

export function parseAgentMarkdown(content: string, filePath?: string): SubagentDefinition | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  if (!fields.name?.trim() || !fields.description?.trim()) {
    return null;
  }
  return {
    name: fields.name.trim(),
    description: fields.description.trim(),
    tools: parseToolList(fields.tools),
    model: fields.model?.trim() || undefined,
    systemPrompt: match[2].trim(),
    source: "project",
    filePath,
  };
}

export function mergeSubagentDefinitions(project: SubagentDefinition[]): SubagentDefinition[] {
  const byName = new Map<string, SubagentDefinition>();
  for (const agent of BUNDLED_SUBAGENTS) {
    byName.set(agent.name, agent);
  }
  for (const agent of project) {
    if (agent.name) {
      byName.set(agent.name, agent);
    }
  }
  return [...byName.values()];
}

export function resolveSubagent(
  agents: SubagentDefinition[],
  name: string,
): SubagentDefinition | null {
  const wanted = name.trim();
  return agents.find((agent) => agent.name === wanted) ?? null;
}

function asTask(value: unknown): SubagentTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent.trim() : "";
  const task = typeof record.task === "string" ? record.task.trim() : "";
  if (!agent || !task) {
    return null;
  }
  return { agent, task };
}

export function parseSubagentRequest(params: Record<string, unknown>): ParsedSubagentRequest | { error: string } {
  const hasSingle = params.agent != null || params.task != null;
  const hasParallel = params.tasks != null;
  const hasChain = params.chain != null;
  const modes = [hasSingle, hasParallel, hasChain].filter(Boolean).length;
  if (modes !== 1) {
    return {
      error:
        "Use exactly one mode: { agent, task }, { tasks: [{ agent, task }] }, or { chain: [{ agent, task }] }.",
    };
  }
  if (hasSingle) {
    const task = asTask({ agent: params.agent, task: params.task });
    if (!task) {
      return { error: "single mode requires non-empty agent and task." };
    }
    return { mode: "single", tasks: [task] };
  }
  const raw = hasParallel ? params.tasks : params.chain;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: `${hasParallel ? "tasks" : "chain"} must be a non-empty array.` };
  }
  if (raw.length > MAX_SUBAGENT_TASKS) {
    return { error: `at most ${MAX_SUBAGENT_TASKS} subagent tasks.` };
  }
  const tasks: SubagentTask[] = [];
  for (const [index, item] of raw.entries()) {
    const task = asTask(item);
    if (!task) {
      return { error: `${hasParallel ? "tasks" : "chain"}[${index}] needs agent and task.` };
    }
    tasks.push(task);
  }
  return { mode: hasParallel ? "parallel" : "chain", tasks };
}

export function applyChainPlaceholder(task: string, previous: string): string {
  return task.replaceAll("{previous}", previous);
}

export function formatSubagentResult(input: {
  mode: SubagentMode;
  results: Array<{ agent: string; content: string; isError?: boolean }>;
}): string {
  return input.results
    .map((item, index) => {
      const heading = input.mode === "single" ? `## ${item.agent}` : `## ${index + 1}. ${item.agent}`;
      const body = item.content.trim() || (item.isError ? "(failed)" : "(no output)");
      return `${heading}\n${body}`;
    })
    .join("\n\n");
}

export function listSubagentNames(agents: SubagentDefinition[]): string {
  return agents.map((agent) => `${agent.name} (${agent.description})`).join("; ");
}
