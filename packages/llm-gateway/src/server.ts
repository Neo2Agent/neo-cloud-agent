import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyRunToken } from "./auth.js";
import { proxyCompletion } from "./proxy.js";

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

export function createGatewayServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://llm-gateway.local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/health") {
        send(res, 200, { ok: true, service: "llm-gateway" });
        return;
      }

      if (method === "POST" && path === "/v1/chat/completions") {
        const token = bearer(req);
        if (!token) {
          send(res, 401, { error: "missing_run_jwt" });
          return;
        }
        const claims = verifyRunToken(token);
        const body = (await readJson(req)) as { model?: string; messages?: unknown[] };
        const result = await proxyCompletion({
          model: body.model ?? claims.model,
          messages: body.messages ?? [],
        });
        send(res, 200, { ...result, runId: claims.runId });
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
