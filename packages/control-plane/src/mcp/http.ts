export type McpToolInfo = { name: string; description?: string };

type JsonRpc = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

async function parseRpc(text: string): Promise<JsonRpc> {
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

export async function callMcpJsonRpc(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string> = {},
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchFn(url, {
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
  const body = await parseRpc(text);
  if (body.error) {
    throw new Error(body.error.message || "MCP error");
  }
  return body.result;
}

export async function listMcpTools(
  url: string,
  headers?: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<McpToolInfo[]> {
  await callMcpJsonRpc(
    url,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "neo-cloud-agent", version: "0.1.0" },
    },
    headers,
    fetchFn,
  );
  const result = (await callMcpJsonRpc(url, "tools/list", {}, headers, fetchFn)) as { tools?: McpToolInfo[] };
  return result.tools ?? [];
}
