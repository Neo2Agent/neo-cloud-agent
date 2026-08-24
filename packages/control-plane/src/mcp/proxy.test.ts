import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mcp-proxy-"));

const { upsertMcpSecret } = await import("./secrets.js");
const { proxyMcpCall, proxyMcpList } = await import("./proxy.js");

test("proxyMcpList and proxyMcpCall attach saved Bearer headers", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-mcp-ws-"));
  mkdirSync(path.join(workspaceDir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".neo/environment.json"),
    JSON.stringify({ mcp: [{ name: "docs", transport: "http", url: "https://mcp.example/rpc" }] }),
  );
  upsertMcpSecret("docs", { headers: { authorization: "Bearer secret-token" } });
  const seen: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push(headers.get("authorization") ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    }
    if (body.method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search" }] } }));
    }
    if (body.method === "tools/call") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } }));
    }
    return new Response(JSON.stringify({ error: body.method }), { status: 400 });
  };
  const listed = await proxyMcpList("run-1", workspaceDir, undefined, fetchFn);
  assert.equal(listed.servers[0]?.tools[0]?.name, "search");
  const called = await proxyMcpCall("run-1", { server: "docs", tool: "search" }, workspaceDir, undefined, fetchFn);
  assert.deepEqual(called, { content: [{ type: "text", text: "ok" }] });
  assert.equal(seen.every((item) => item === "Bearer secret-token"), true);
});
