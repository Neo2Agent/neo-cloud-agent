import { randomUUID } from "node:crypto";
import type { StartTurnRequest } from "@neo-cloud-agent/contracts";
import type { ControlPlane, LoopEvent } from "./cloud.js";
import type { ToolsHub } from "./hub.js";
import {
  DUPLICATE_STOP,
  REPEAT_NOTE,
  RUNAWAY_STOP,
  SLEEP_POLL_NOTE,
  WRAP_STEER,
  classifyRepeat,
  isSleepPoll,
  needsWrap,
  toolSignature,
  type RepeatState,
} from "./repeat.js";
import { TOOL_DEFINITIONS, clipToolOutput, runTool } from "./tools.js";

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
    let repeat: RepeatState = { last: "", streak: 0 };
    const prior = new Map<string, string>();
    let toolRounds = 0;
    let wrapArmed = false;

    while (true) {
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
        if (wrapArmed) {
          input.hub.abortAll(request.runId);
          if (completion.content) {
            await emitText(emit, request.turnId, completion.content);
          }
          await emit("llm.error", RUNAWAY_STOP, { error: RUNAWAY_STOP });
          await cloud.complete(request.runId, request.turnId, "error", RUNAWAY_STOP, false, usage);
          return;
        }
        toolRounds += 1;
        messages.push({
          role: "assistant",
          content: completion.content || null,
          tool_calls: completion.toolCalls,
        });
        if (completion.content) {
          await emitText(emit, request.turnId, completion.content);
        }
        await cloud.heartbeat(request.runId, request.turnId, "tool");
        const stopped = await runToolBatch({
          calls: completion.toolCalls,
          repeat,
          prior,
          messages,
          emit,
          hub: input.hub,
          runId: request.runId,
          aborted: control.aborted,
        });
        repeat = stopped.repeat;
        if (stopped.halt) {
          input.hub.abortAll(request.runId);
          await emit("llm.error", DUPLICATE_STOP, { error: DUPLICATE_STOP });
          await cloud.complete(request.runId, request.turnId, "error", DUPLICATE_STOP, false, usage);
          return;
        }
        if (needsWrap(toolRounds)) {
          messages.push({ role: "user", content: WRAP_STEER });
          wrapArmed = true;
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
    await cloud.complete(request.runId, request.turnId, "idle", "", true, usage);
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

const PARALLEL_TOOLS = new Set(["read", "grep", "find", "ls"]);
const OUTPUT_FLUSH_MS = 100;

type Emitter = (kind: string, title: string, data: Record<string, unknown>) => Promise<void>;

type PlannedCall = {
  call: ToolCall;
  args: Record<string, unknown>;
  signature: string;
  action: "run" | "replay" | "stop";
  parallel: boolean;
};

async function runToolBatch(input: {
  calls: ToolCall[];
  repeat: RepeatState;
  prior: Map<string, string>;
  messages: ModelMessage[];
  emit: Emitter;
  hub: ToolsHub;
  runId: string;
  aborted: () => boolean;
}): Promise<{ repeat: RepeatState; halt: boolean }> {
  let repeat = input.repeat;
  const planned: PlannedCall[] = [];
  for (const call of input.calls) {
    const args = parseArgs(call.function.arguments);
    const signature = toolSignature(call.function.name, args);
    const next = classifyRepeat(repeat, signature);
    repeat = next.state;
    planned.push({
      call,
      args,
      signature,
      action: next.action,
      parallel: next.action === "run" && PARALLEL_TOOLS.has(call.function.name),
    });
    if (next.action === "stop") {
      break;
    }
  }

  let index = 0;
  while (index < planned.length) {
    if (input.aborted()) {
      break;
    }
    const step = planned[index];
    if (!step) {
      break;
    }
    if (step.action === "stop") {
      return { repeat, halt: true };
    }
    if (step.action === "replay") {
      input.messages.push({
        role: "tool",
        tool_call_id: step.call.id,
        content: `${REPEAT_NOTE}\n${input.prior.get(step.signature) ?? ""}`,
      });
      index += 1;
      continue;
    }
    if (step.parallel) {
      const batch: PlannedCall[] = [];
      while (index < planned.length && planned[index]?.action === "run" && planned[index]?.parallel) {
        const item = planned[index];
        if (!item) {
          break;
        }
        batch.push(item);
        index += 1;
      }
      await runParallelReads(input, batch);
      continue;
    }
    await runOneTool(input, step);
    index += 1;
  }
  return { repeat, halt: false };
}

async function runParallelReads(
  input: {
    prior: Map<string, string>;
    messages: ModelMessage[];
    emit: Emitter;
    hub: ToolsHub;
    runId: string;
  },
  batch: PlannedCall[],
): Promise<void> {
  for (const step of batch) {
    await emitToolStart(input.emit, step);
  }
  const outputs = await Promise.all(
    batch.map((step) => runTool(input.hub, input.runId, step.call.function.name, step.args)),
  );
  for (let item = 0; item < batch.length; item += 1) {
    const step = batch[item];
    const output = outputs[item] ?? "";
    if (!step) {
      continue;
    }
    input.prior.set(step.signature, output);
    await emitToolFinish(input.emit, step, output);
    input.messages.push({ role: "tool", tool_call_id: step.call.id, content: output });
  }
}

async function runOneTool(
  input: {
    prior: Map<string, string>;
    messages: ModelMessage[];
    emit: Emitter;
    hub: ToolsHub;
    runId: string;
  },
  step: PlannedCall,
): Promise<void> {
  await emitToolStart(input.emit, step);
  const command = typeof step.args.command === "string" ? step.args.command : "";
  const blocked = step.call.function.name === "bash" && isSleepPoll(command);
  const pump = !blocked && step.call.function.name === "bash"
    ? createOutputPump(async (text) => {
        await input.emit("tool.update", `Tool ${step.call.function.name}`, {
          toolName: step.call.function.name,
          toolCallId: step.call.id,
          output: text,
        });
      })
    : undefined;
  const output = blocked
    ? SLEEP_POLL_NOTE
    : await runTool(input.hub, input.runId, step.call.function.name, step.args, pump ? (text) => pump.push(clipToolOutput(text)) : undefined);
  await pump?.flush();
  input.prior.set(step.signature, output);
  await emitToolFinish(input.emit, step, output);
  input.messages.push({ role: "tool", tool_call_id: step.call.id, content: output });
}

function createOutputPump(publish: (text: string) => Promise<void>): { push: (text: string) => void; flush: () => Promise<void> } {
  let latest = "";
  let sent = "";
  let timer: NodeJS.Timeout | undefined;
  let chain = Promise.resolve();
  const enqueue = () => {
    if (latest === sent) {
      return;
    }
    const text = latest;
    sent = text;
    chain = chain.then(() => publish(text));
  };
  return {
    push(text: string) {
      latest = text;
      if (timer) {
        return;
      }
      enqueue();
      timer = setTimeout(() => {
        timer = undefined;
        enqueue();
      }, OUTPUT_FLUSH_MS);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      enqueue();
      await chain;
    },
  };
}

async function emitToolStart(emit: Emitter, step: PlannedCall): Promise<void> {
  await emit("tool.start", `Tool ${step.call.function.name}`, {
    toolName: step.call.function.name,
    toolCallId: step.call.id,
    args: step.args,
  });
}

async function emitToolFinish(emit: Emitter, step: PlannedCall, output: string): Promise<void> {
  await emit("tool.update", `Tool ${step.call.function.name}`, {
    toolName: step.call.function.name,
    toolCallId: step.call.id,
    output,
  });
  await emit("tool.end", `Tool ${step.call.function.name} finished`, {
    toolName: step.call.function.name,
    toolCallId: step.call.id,
    output,
    isError: false,
  });
}

function systemMessage(request: StartTurnRequest): ModelMessage {
  const parts = [
    "You are Neo. File and shell tools run on the user's computer. Paths are relative to that folder.",
    "Put independent read-only tools (read, grep, find, ls) in the same reply. Keep bash, edit, and write in order.",
    "Do not use sleep to poll for builds, installs, or emulators. Run the command itself, or read the log after it finishes.",
    "When the task is done, write the result and stop calling tools.",
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
