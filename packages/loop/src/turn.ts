import { randomUUID } from "node:crypto";
import type { StartTurnRequest } from "@neo-cloud-agent/contracts";
import type { ControlPlane, LoopEvent } from "./cloud.js";
import type { ToolsHub } from "./hub.js";
import { TOOL_DEFINITIONS, runTool } from "./tools.js";

const MAX_ROUNDS = 8;

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type Completion = {
  content: string;
  toolCalls: ToolCall[];
  promptTokens: number;
  completionTokens: number;
};

export type Infer = (input: {
  url: string;
  jwt: string;
  model: string;
  messages: ModelMessage[];
  signal: AbortSignal;
}) => Promise<Completion>;

export type TurnControl = {
  signal: AbortSignal;
  aborted: () => boolean;
  takeSteer: () => string | undefined;
};

export async function runTurn(input: {
  request: StartTurnRequest;
  cloud: ControlPlane;
  hub: ToolsHub;
  infer: Infer;
  control: TurnControl;
}): Promise<void> {
  const { request, cloud, control } = input;
  const usage = { inputTokens: 0, outputTokens: 0 };
  const emit = createEmitter(cloud, request.runId, request.turnId);
  try {
    await cloud.heartbeat(request.runId, request.turnId, "ensure");
    if (control.aborted()) {
      input.hub.abortAll(request.runId);
      await cloud.complete(request.runId, request.turnId, "idle", "", true, usage);
      return;
    }
    await Promise.race([
      input.hub.waitReady(request.runId),
      new Promise<never>((_resolve, reject) => {
        if (control.aborted()) {
          reject(new Error("aborted"));
          return;
        }
        control.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ]);
    const messages = await loadMessages(cloud, request);
    messages.push({ role: "user", content: userText(request) });
    await emit("agent.start", "Agent turn started", { replyId: request.turnId });

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const steered = control.takeSteer();
      if (steered) {
        messages.push({ role: "user", content: steered });
      }
      if (control.aborted()) {
        break;
      }
      await cloud.heartbeat(request.runId, request.turnId, "infer");
      const completion = await input.infer({
        url: request.llmGatewayUrl,
        jwt: request.jwt,
        model: request.model,
        messages: [systemMessage(request), ...messages.filter((item) => item.role !== "system")],
        signal: control.signal,
      });
      usage.inputTokens += completion.promptTokens;
      usage.outputTokens += completion.completionTokens;
      if (completion.promptTokens || completion.completionTokens) {
        await emit("llm.usage", "Token usage", {
          promptTokens: completion.promptTokens,
          completionTokens: completion.completionTokens,
          totalTokens: completion.promptTokens + completion.completionTokens,
        });
      }
      if (completion.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: completion.content || null,
          tool_calls: completion.toolCalls,
        });
        if (completion.content) {
          await emitText(emit, request.turnId, completion.content);
        }
        await cloud.heartbeat(request.runId, request.turnId, "tool");
        for (const call of completion.toolCalls) {
          if (control.aborted()) {
            break;
          }
          const args = parseArgs(call.function.arguments);
          await emit("tool.start", `Tool ${call.function.name}`, {
            toolName: call.function.name,
            toolCallId: call.id,
            args,
          });
          const output = await runTool(input.hub, request.runId, call.function.name, args);
          await emit("tool.update", `Tool ${call.function.name}`, {
            toolName: call.function.name,
            toolCallId: call.id,
            output,
          });
          await emit("tool.end", `Tool ${call.function.name} finished`, {
            toolName: call.function.name,
            toolCallId: call.id,
            output,
            isError: false,
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
        continue;
      }
      const text = completion.content || "模型没有返回内容";
      await emitText(emit, request.turnId, text);
      messages.push({ role: "assistant", content: text });
      await cloud.saveSession(request.runId, { messages: messages.filter((item) => item.role !== "system") });
      if (control.aborted()) {
        break;
      }
      await cloud.complete(request.runId, request.turnId, "idle", "", false, usage);
      return;
    }

    input.hub.abortAll(request.runId);
    await cloud.saveSession(request.runId, { messages: messages.filter((item) => item.role !== "system") });
    if (control.aborted()) {
      await cloud.complete(request.runId, request.turnId, "idle", "", true, usage);
      return;
    }
    await emit("llm.error", "工具回合过多", { error: "too many tool rounds" });
    await cloud.complete(request.runId, request.turnId, "error", "too many tool rounds", false, usage);
  } catch (error) {
    if (control.aborted()) {
      input.hub.abortAll(request.runId);
      await cloud.complete(request.runId, request.turnId, "idle", "", true, usage);
      return;
    }
    const message = error instanceof Error ? error.message : "turn failed";
    await emit("llm.error", "模型调用失败", { error: message });
    await cloud.complete(request.runId, request.turnId, "error", message, false, usage);
  }
}

export async function inferChat(input: {
  url: string;
  jwt: string;
  model: string;
  messages: ModelMessage[];
  signal: AbortSignal;
}): Promise<Completion> {
  const response = await fetch(`${input.url.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    signal: input.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.jwt}`,
      "x-neo-step-id": randomUUID(),
    },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: input.messages,
      tools: TOOL_DEFINITIONS,
    }),
  });
  if (!response.ok) {
    throw new Error(`gateway ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: ToolCall[] } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = body.choices?.[0]?.message;
  return {
    content: typeof message?.content === "string" ? message.content : "",
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
  };
}

function systemMessage(request: StartTurnRequest): ModelMessage {
  const parts = [
    "You are Neo. File and shell tools run on the user's computer. Paths are relative to that folder.",
  ];
  if (request.workspace?.agentsMd) {
    parts.push(request.workspace.agentsMd);
  }
  if (request.workspace?.systemPromptExtra) {
    parts.push(request.workspace.systemPromptExtra);
  }
  return { role: "system", content: parts.join("\n\n") };
}

function userText(request: StartTurnRequest): string {
  const images = request.images?.length ?? 0;
  if (!images) {
    return request.text;
  }
  return `${request.text}\n\n(${images} image attachments were not forwarded to the model.)`;
}

async function loadMessages(cloud: ControlPlane, request: StartTurnRequest): Promise<ModelMessage[]> {
  const state = await cloud.loadSession(request.runId);
  const messages = state.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(isModelMessage);
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const role = (value as { role?: unknown }).role;
  return role === "user" || role === "assistant" || role === "tool";
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The model sent arguments that are not JSON.
  }
  return {};
}

function createEmitter(cloud: ControlPlane, runId: string, turnId: string) {
  let seq = 0;
  return async (kind: string, title: string, data: Record<string, unknown>) => {
    seq += 1;
    const event: LoopEvent = {
      id: randomUUID(),
      runId,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: kind === "llm.error" ? "error" : "info",
      kind,
      title,
      data: { ...data, workerSeq: seq, workerEpoch: turnId },
    };
    await cloud.emit(runId, [event]);
  };
}

async function emitText(
  emit: (kind: string, title: string, data: Record<string, unknown>) => Promise<void>,
  replyId: string,
  text: string,
): Promise<void> {
  await emit("message.start", "Assistant message started", { replyId });
  await emit("message.delta", "Assistant text", { delta: text, replyId });
  await emit("message.end", "Assistant message completed", { replyId });
}
