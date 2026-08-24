import { evaluateEgress, type EgressPolicy, type McpServerSpec } from "@neo-cloud-agent/contracts";
import { workspaceFor } from "../worker-spawn.js";
import { callMcpJsonRpc, listMcpTools } from "./http.js";
import { headersForMcpServer } from "./secrets.js";
import { listWorkspaceMcpServers } from "./workspace.js";

export type ProxiedMcpList = {
  servers: Array<{ name: string; transport: string; tools: Array<{ name: string; description?: string }>; error?: string }>;
};

function requireHttpSpec(workspaceDir: string, serverName: string): McpServerSpec {
  const spec = listWorkspaceMcpServers(workspaceDir).find((item) => item.name === serverName);
  if (!spec) {
    throw new Error(`unknown MCP server: ${serverName}`);
  }
  if (spec.transport !== "http" || !spec.url) {
    throw new Error(`MCP server ${serverName} is not HTTP; call it from the worker`);
  }
  return spec;
}

function assertEgress(url: string, policy?: EgressPolicy): void {
  if (!policy) {
    return;
  }
  const decision = evaluateEgress(policy, url);
  if (!decision.allow) {
    throw new Error(decision.reason || "egress denied");
  }
}

export async function proxyMcpList(
  runId: string,
  workspaceDir = workspaceFor(runId),
  policy?: EgressPolicy,
  fetchFn: typeof fetch = fetch,
): Promise<ProxiedMcpList> {
  const servers = listWorkspaceMcpServers(workspaceDir);
  const out: ProxiedMcpList["servers"] = [];
  for (const server of servers) {
    if (server.transport !== "http" || !server.url) {
      out.push({ name: server.name, transport: server.transport, tools: [], error: "stdio MCP stays in the worker" });
      continue;
    }
    try {
      assertEgress(server.url, policy);
      const tools = await listMcpTools(server.url, headersForMcpServer(server.name), fetchFn);
      out.push({ name: server.name, transport: "http", tools });
    } catch (error) {
      out.push({
        name: server.name,
        transport: "http",
        tools: [],
        error: error instanceof Error ? error.message : "list failed",
      });
    }
  }
  return { servers: out };
}

export async function proxyMcpCall(
  runId: string,
  input: { server: string; tool: string; arguments?: Record<string, unknown> },
  workspaceDir = workspaceFor(runId),
  policy?: EgressPolicy,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const spec = requireHttpSpec(workspaceDir, input.server);
  assertEgress(spec.url!, policy);
  const headers = headersForMcpServer(spec.name);
  await callMcpJsonRpc(
    spec.url!,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "neo-cloud-agent", version: "0.1.0" },
    },
    headers,
    fetchFn,
  );
  return callMcpJsonRpc(
    spec.url!,
    "tools/call",
    { name: input.tool, arguments: input.arguments ?? {} },
    headers,
    fetchFn,
  );
}
