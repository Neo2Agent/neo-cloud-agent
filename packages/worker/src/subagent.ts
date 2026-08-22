import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  MAX_SUBAGENT_CONCURRENCY,
  SUBAGENT_TIMEOUT_MS,
  SUBSCRIPTION_TOOL_NAME,
  applyChainPlaceholder,
  formatSubagentResult,
  listSubagentNames,
  parseSubagentRequest,
  resolveSubagent,
  SUBAGENT_TOOL_NAME,
} from "@neo-cloud-agent/contracts";
import { availableSubagents, type CloudToolResult } from "@neo-cloud-agent/extensions";
import { CLOUD_SYSTEM_PROMPT, sessionToolNames } from "./cloud-tools.js";
import type { LooseAgentEvent } from "./events.js";
import type { OpenSessionInput } from "./session.js";

export type SubagentNest = { id: string; agent: string };

export type SubagentEventHandler = (event: LooseAgentEvent, nest: SubagentNest) => void;

export type SubagentRunInput = OpenSessionInput & {
  params: Record<string, unknown>;
  onSubagentEvent?: SubagentEventHandler;
};

const liveNested = new Set<AgentSession>();

export function abortNestedSubagents(): void {
  for (const session of liveNested) {
    void session.abort();
  }
}

async function promptWithTimeout(session: AgentSession, task: string, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void session.abort();
      reject(new Error(`subagent timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  try {
    await Promise.race([session.prompt(task), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function lastAssistantText(session: AgentSession): string {
  const chunks: string[] = [];
  try {
    for (const message of session.messages) {
      const record = message as { role?: string; content?: unknown };
      if (record.role !== "assistant") {
        continue;
      }
      chunks.length = 0;
      const content = record.content;
      if (typeof content === "string") {
        chunks.push(content);
        continue;
      }
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string" && text.trim()) {
            chunks.push(text);
          }
        }
      }
    }
  } catch {
    return "";
  }
  return chunks.join("").trim();
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runOne(input: SubagentRunInput, agentName: string, task: string): Promise<CloudToolResult> {
  const agents = availableSubagents(input.cwd);
  const agent = resolveSubagent(agents, agentName);
  if (!agent) {
    return {
      content: `Unknown agent "${agentName}". Available: ${listSubagentNames(agents)}`,
      isError: true,
    };
  }
  const { openPiSession } = await import("./session.js");
  const nest: SubagentNest = {
    id: `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    agent: agent.name,
  };
  const tools = (agent.tools ?? sessionToolNames({ includeSubagent: false })).filter(
    (name) => name !== SUBAGENT_TOOL_NAME && name !== SUBSCRIPTION_TOOL_NAME,
  );
  const started = Date.now();
  const session = await openPiSession({
    ...input,
    sessionDir: path.join(input.sessionDir, "subagents", nest.id),
    allowSubagent: false,
    tools,
    systemPrompt: `${CLOUD_SYSTEM_PROMPT}\n\n# Subagent: ${agent.name}\n${agent.systemPrompt}`,
  });
  const unsubscribe = session.subscribe((event) => {
    input.onSubagentEvent?.(event as LooseAgentEvent, nest);
  });
  liveNested.add(session);
  try {
    await promptWithTimeout(session, task, SUBAGENT_TIMEOUT_MS);
    const content = lastAssistantText(session) || "(no output)";
    return {
      content,
      details: {
        agent: agent.name,
        agentSource: agent.source,
        subagentId: nest.id,
        durationMs: Date.now() - started,
      },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "subagent failed",
      isError: true,
      details: { agent: agent.name, subagentId: nest.id, durationMs: Date.now() - started },
    };
  } finally {
    liveNested.delete(session);
    unsubscribe();
    session.dispose();
  }
}

export async function executeNestedSubagent(input: SubagentRunInput): Promise<CloudToolResult> {
  const parsed = parseSubagentRequest(input.params);
  if ("error" in parsed) {
    return { content: parsed.error, isError: true };
  }
  if (parsed.mode === "single") {
    const only = parsed.tasks[0]!;
    return runOne(input, only.agent, only.task);
  }
  if (parsed.mode === "chain") {
    const results: Array<{ agent: string; content: string; isError?: boolean }> = [];
    let previous = "";
    for (const step of parsed.tasks) {
      const result = await runOne(input, step.agent, applyChainPlaceholder(step.task, previous));
      results.push({ agent: step.agent, content: result.content, isError: result.isError });
      if (result.isError) {
        break;
      }
      previous = result.content;
    }
    return {
      content: formatSubagentResult({ mode: "chain", results }),
      isError: results.some((item) => item.isError),
      details: { mode: "chain", agents: results.map((item) => item.agent) },
    };
  }
  const results = await mapPool(parsed.tasks, MAX_SUBAGENT_CONCURRENCY, (step) =>
    runOne(input, step.agent, step.task),
  );
  const labeled = results.map((result, index) => ({
    agent: parsed.tasks[index]!.agent,
    content: result.content,
    isError: result.isError,
  }));
  return {
    content: formatSubagentResult({ mode: "parallel", results: labeled }),
    isError: labeled.some((item) => item.isError),
    details: { mode: "parallel", agents: labeled.map((item) => item.agent) },
  };
}
