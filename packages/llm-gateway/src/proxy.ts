import { getConfig } from "./config.js";
import { messagesHaveImages, resolveUpstreamModel, visionModelFor } from "./routes.js";

export interface ChatCompletionBody {
  model?: string;
  stream?: boolean;
  messages?: unknown[];
  [key: string]: unknown;
}

export function rewriteBody(body: ChatCompletionBody, fallbackModel: string): ChatCompletionBody {
  const requested = typeof body.model === "string" ? body.model : fallbackModel;
  let model = resolveUpstreamModel(requested, fallbackModel);
  if (messagesHaveImages(body.messages)) {
    model = visionModelFor(model);
  }
  return { ...body, model };
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
  "Mock gateway response. Save a DeepSeek or OpenAI API key on the chat page, or set DEEPSEEK_API_KEY / OPENAI_API_KEY.";

const MOCK_SLOW_TEXT =
  "这是一段故意拉长的 mock 流式回复，方便两台 Desk 同时订同一条 SSE。你会一个字一个字看到输出。在这段还没结束时，另一位协作者可以发跟进；消息会进 FIFO 队列，不会再开第二个 worker。";

function mockStreamDelayMs(): number {
  const n = Number(process.env.MOCK_STREAM_DELAY_MS ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0;
}

function buildMockSseStream(model: string, text: string, delayMs: number): ReadableStream<Uint8Array> {
  const id = `chatcmpl-mock-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const parts = /[\u4e00-\u9fff]/.test(text) ? [...text] : text.split(/(\s+)/).filter(Boolean);
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const [index, part] of parts.entries()) {
        const chunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { ...(index === 0 ? { role: "assistant" } : {}), content: part },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

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
    const delayMs = mockStreamDelayMs();
    const text = delayMs ? MOCK_SLOW_TEXT : MOCK_TEXT;
    return {
      status: 200,
      headers: {
        "content-type": stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8",
      },
      stream,
      payload: stream
        ? delayMs
          ? buildMockSseStream(model, text, delayMs)
          : buildMockSse(model, text)
        : JSON.stringify(buildMockCompletion(model, text)),
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
