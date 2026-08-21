import { spawn } from "node:child_process";
import type { McpServerSpec } from "@neo-cloud-agent/contracts";
import type { CloudToolFetch } from "./types.js";

export type McpToolInfo = {
  name: string;
  description?: string;
};

type JsonRpc = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number };
};

function interpolate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => env[key] ?? "");
}

function interpolateRecord(record: Record<string, string> | undefined, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    out[key] = interpolate(value, env);
  }
  return out;
}

async function parseRpcResponse(text: string): Promise<JsonRpc> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpc;
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length > 0) {
    return JSON.parse(dataLines.at(-1) ?? "{}") as JsonRpc;
  }
  throw new Error("MCP server returned a non-JSON response");
}

export async function callMcpHttp(
  spec: McpServerSpec,
  method: string,
  params: unknown,
  fetchFn: CloudToolFetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  if (!spec.url) {
    throw new Error(`MCP server ${spec.name} is missing url`);
  }
  const headers = interpolateRecord(spec.headers, env);
  const response = await fetchFn(spec.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 1_000_000, method, params }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  const body = await parseRpcResponse(text);
  if (body.error) {
    throw new Error(body.error.message || "MCP error");
  }
  return body.result;
}

export async function listMcpHttpTools(
  spec: McpServerSpec,
  fetchFn: CloudToolFetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpToolInfo[]> {
  await callMcpHttp(
    spec,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "neo-cloud-agent", version: "0.1.0" },
    },
    fetchFn,
    env,
  );
  const result = (await callMcpHttp(spec, "tools/list", {}, fetchFn, env)) as { tools?: McpToolInfo[] };
  return result.tools ?? [];
}

export async function callMcpHttpTool(
  spec: McpServerSpec,
  tool: string,
  args: Record<string, unknown>,
  fetchFn: CloudToolFetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  return callMcpHttp(spec, "tools/call", { name: tool, arguments: args }, fetchFn, env);
}

export async function runMcpStdio(
  spec: McpServerSpec,
  requests: Array<{ method: string; params?: unknown }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown[]> {
  if (!spec.command) {
    throw new Error(`MCP server ${spec.name} is missing command`);
  }
  const childEnv = { ...env, ...interpolateRecord(spec.env, env) };
  const child = spawn(spec.command, spec.args ?? [], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const results: unknown[] = [];
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  const fail = (error: Error) => {
    for (const item of pending.values()) {
      item.reject(error);
    }
    pending.clear();
  };

  const consume = () => {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) {
        return;
      }
      const json = buffer.subarray(start, start + length).toString("utf8");
      buffer = buffer.subarray(start + length);
      let message: JsonRpc;
      try {
        message = JSON.parse(json) as JsonRpc;
      } catch {
        continue;
      }
      if (message.id == null) {
        continue;
      }
      const waiter = pending.get(Number(message.id));
      if (!waiter) {
        continue;
      }
      pending.delete(Number(message.id));
      if (message.error) {
        waiter.reject(new Error(message.error.message || "MCP error"));
      } else {
        waiter.resolve(message.result);
      }
    }
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
  child.on("error", (error) => fail(error instanceof Error ? error : new Error("MCP spawn failed")));
  child.on("exit", (code) => {
    if (pending.size > 0) {
      fail(new Error(`MCP server exited (${code ?? "?"})`));
    }
  });

  const rpc = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      child.stdin?.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP ${method} timed out`));
        }
      }, 15_000);
    });

  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "neo-cloud-agent", version: "0.1.0" },
    });
    const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    child.stdin?.write(`Content-Length: ${Buffer.byteLength(initialized)}\r\n\r\n${initialized}`);
    for (const request of requests) {
      results.push(await rpc(request.method, request.params));
    }
    return results;
  } finally {
    child.stdin?.end();
    child.kill("SIGTERM");
  }
}
