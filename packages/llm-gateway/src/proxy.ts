import { getConfig } from "./config.js";
import { resolveUpstreamModel } from "./routes.js";

export interface ChatCompletionBody {
  model?: string;
  stream?: boolean;
  messages?: unknown[];
  [key: string]: unknown;
}

export function rewriteBody(body: ChatCompletionBody, fallbackModel: string): ChatCompletionBody {
  const requested = typeof body.model === "string" ? body.model : fallbackModel;
  return { ...body, model: resolveUpstreamModel(requested, fallbackModel) };
}

export function buildMockSse(model: string, text: string): string {
  const id = `chatcmpl-mock-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const start = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  };
  const stop = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  return `data: ${JSON.stringify(start)}\n\ndata: ${JSON.stringify(stop)}\n\ndata: [DONE]\n\n`;
}

export function buildMockCompletion(model: string, text: string) {
  return {
    id: `chatcmpl-mock-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

const MOCK_TEXT =
  "Mock gateway response. Set DEEPSEEK_API_KEY or OPENAI_API_KEY, or LLM_UPSTREAM=deepseek|openai.";

export async function proxyChatCompletions(body: ChatCompletionBody): Promise<{
  status: number;
  headers: Record<string, string>;
  stream: boolean;
  payload: string | ReadableStream<Uint8Array>;
}> {
  const config = getConfig();
  const rewritten = rewriteBody(body, config.upstreamModel);
  const stream = Boolean(rewritten.stream);
  const model = String(rewritten.model);

  if (config.upstream === "mock") {
    return {
      status: 200,
      headers: {
        "content-type": stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8",
      },
      stream,
      payload: stream ? buildMockSse(model, MOCK_TEXT) : JSON.stringify(buildMockCompletion(model, MOCK_TEXT)),
    };
  }

  if (!config.upstreamApiKey) {
    throw new Error(`${config.upstream} upstream is selected but no API key is configured`);
  }

  const response = await fetch(`${config.upstreamBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.upstreamApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(rewritten),
  });

  if (stream) {
    if (!response.body) {
      throw new Error("upstream returned no body");
    }
    return {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      },
      stream: true,
      payload: response.body,
    };
  }

  const payload = await response.text();
  return {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8" },
    stream: false,
    payload,
  };
}
