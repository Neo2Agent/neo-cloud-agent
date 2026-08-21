import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyRunToken } from "./auth.js";
import { getConfig } from "./config.js";
import { proxyChatCompletions, type ChatCompletionBody } from "./proxy.js";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

async function writePayload(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  payload: string | ReadableStream<Uint8Array>,
): Promise<void> {
  res.writeHead(status, headers);
  if (typeof payload === "string") {
    res.end(payload);
    return;
  }
  const reader = payload.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

export function createGatewayServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://llm-gateway.local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/health") {
        const config = getConfig();
        send(res, 200, { ok: true, service: "llm-gateway", upstream: config.upstream });
        return;
      }

      if (method === "POST" && path === "/v1/chat/completions") {
        const token = bearer(req);
        if (!token) {
          send(res, 401, { error: "missing_run_jwt" });
          return;
        }
        verifyRunToken(token);
        const body = (await readJson(req)) as ChatCompletionBody;
        const result = await proxyChatCompletions(body);
        await writePayload(res, result.status, result.headers, result.payload);
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      const status = message.includes("token") ? 401 : 500;
      send(res, status, { error: message });
    }
  });
}
