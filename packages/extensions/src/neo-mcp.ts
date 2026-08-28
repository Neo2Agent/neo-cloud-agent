import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnvironmentJson, type McpServerSpec } from "@neo-cloud-agent/contracts";
import { asString, callControlPlane } from "./client.js";
import { callMcpHttpTool, listMcpHttpTools, runMcpStdio } from "./mcp-client.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

type RemoteMcpList = {
  servers: Array<{
    name: string;
    transport: string;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  }>;
};

async function listViaControlPlane(ctx: CloudToolContext): Promise<RemoteMcpList | null> {
  try {
    return await callControlPlane<RemoteMcpList>(ctx, `/internal/runs/${ctx.runId}/mcp`, {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });
  } catch {
    return null;
  }
}

async function callViaControlPlane(
  ctx: CloudToolContext,
  input: { server: string; tool: string; arguments: Record<string, unknown> },
): Promise<unknown> {
  const body = await callControlPlane<{ result?: unknown }>(ctx, `/internal/runs/${ctx.runId}/mcp`, {
    method: "POST",
    body: JSON.stringify({ action: "call", ...input }),
  });
  return body.result;
}

export const neoMcp = defineExtension({
  name: "neo-mcp",
  description: "Start HTTP/stdio MCP servers from environment.json. Tokens are interpolated from the worker env.",
});

const CANDIDATES = [".neo/environment.json", ".cursor/environment.json"] as const;

function readEnvFile(file: string): McpServerSpec[] {
  if (!existsSync(file) || !statSync(file).isFile()) {
    return [];
  }
  try {
    return parseEnvironmentJson(JSON.parse(readFileSync(file, "utf8"))).mcp ?? [];
  } catch {
    return [];
  }
}

export function listWorkspaceMcpServers(workspaceDir: string): McpServerSpec[] {
  const servers: McpServerSpec[] = [];
  const seen = new Set<string>();
  const add = (file: string) => {
    for (const server of readEnvFile(file)) {
      if (seen.has(server.name)) continue;
      seen.add(server.name);
      servers.push(server);
    }
  };
  for (const rel of CANDIDATES) {
    add(path.join(workspaceDir, rel));
  }
  if (servers.length === 0 && existsSync(workspaceDir)) {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      for (const rel of CANDIDATES) {
        add(path.join(workspaceDir, entry.name, rel));
      }
    }
  }
  return servers;
}

function formatMcpResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return record.content
        .map((item) => {
          if (item && typeof item === "object" && "text" in item) {
            return String((item as { text: unknown }).text);
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return value == null ? "" : String(value);
}

export async function executeMcpList(
  ctx: CloudToolContext,
  _params: Record<string, unknown> = {},
): Promise<CloudToolResult> {
  const servers = listWorkspaceMcpServers(ctx.workspaceDir);
  if (servers.length === 0) {
    return { content: "No MCP servers in environment.json (mcp: []).", details: { servers: [] } };
  }
  const remote = await listViaControlPlane(ctx);
  const lines = [`${servers.length} MCP server(s):`];
  for (const server of servers) {
    lines.push(`- ${server.name} (${server.transport}${server.url ? ` ${server.url}` : ""}${server.command ? ` ${server.command}` : ""})`);
    try {
      const proxied = remote?.servers.find((item) => item.name === server.name);
      const tools =
        server.transport === "http"
          ? proxied && !proxied.error
            ? proxied.tools
            : await listMcpHttpTools(server, ctx.fetch ?? globalThis.fetch)
          : (((await runMcpStdio(server, [{ method: "tools/list", params: {} }]))[0] as { tools?: Array<{ name: string; description?: string }> })
              ?.tools ?? []);
      if (tools.length === 0) {
        lines.push(proxied?.error ? `  error: ${proxied.error}` : "  tools: (none)");
      } else {
        for (const tool of tools) {
          lines.push(`  • ${tool.name}${tool.description ? ` — ${tool.description}` : ""}`);
        }
      }
    } catch (error) {
      lines.push(`  error: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return { content: lines.join("\n"), details: { servers: servers.map((item) => item.name) } };
}

export async function executeMcpCall(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const serverName = asString(params.server).trim();
  const tool = asString(params.tool).trim();
  if (!serverName || !tool) {
    return { content: "server and tool are required.", isError: true };
  }
  const spec = listWorkspaceMcpServers(ctx.workspaceDir).find((item) => item.name === serverName);
  if (!spec) {
    return { content: `unknown MCP server: ${serverName}`, isError: true };
  }
  const args =
    params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};
  try {
    let result: unknown;
    if (spec.transport === "http") {
      try {
        result = await callViaControlPlane(ctx, { server: serverName, tool, arguments: args });
      } catch {
        result = await callMcpHttpTool(spec, tool, args, ctx.fetch ?? globalThis.fetch);
      }
    } else {
      result = (await runMcpStdio(spec, [{ method: "tools/call", params: { name: tool, arguments: args } }]))[0];
    }
    return { content: formatMcpResult(result) || "(empty)", details: { server: serverName, tool } };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "MCP call failed",
      isError: true,
      details: { server: serverName, tool },
    };
  }
}

export function createMcpListTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_mcp_list",
    label: "Neo MCP List",
    description:
      "List MCP servers from .neo/environment.json and the tools each server exposes. Use before neo_mcp_call.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: (params) => executeMcpList(ctx, params),
  };
}

export function createMcpCallTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_mcp_call",
    label: "Neo MCP Call",
    description:
      "Call one tool on an MCP server defined in environment.json. HTTP tokens stay on the control plane.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["server", "tool"],
      properties: {
        server: { type: "string", description: "MCP server name from environment.json" },
        tool: { type: "string", description: "Tool name on that server" },
        arguments: { type: "object", description: "JSON arguments for the MCP tool" },
      },
    },
    execute: (params) => executeMcpCall(ctx, params),
  };
}
