/**
 * In-process control-plane fixture for core boundary tests.
 * Env must be set before any control-plane import.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.AGENT_KERNEL = "pi";
process.env.LLM_UPSTREAM = "mock";
process.env.LLM_GATEWAY_JWT_SECRET = process.env.LLM_GATEWAY_JWT_SECRET || "core-e2e-secret";
process.env.ACCOUNTS_REQUIRED = "1";
process.env.DEFAULT_ADMIN = "1";
process.env.RATE_LIMIT = "0";
process.env.BUILD_CAPTURE = "0";
process.env.OBJECT_STORE = "memory";
process.env.LLM_GATEWAY_URL = process.env.CORE_E2E_GATEWAY_URL ?? "http://127.0.0.1:9";
process.env.RUNS_DIR = process.env.CORE_E2E_RUNS_DIR ?? mkdtempSync(path.join(tmpdir(), "neo-core-e2e-"));
process.env.HOST_RUNS_DIR = process.env.RUNS_DIR;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.MEM0_URL;
delete process.env.MEM0_API_KEY;
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.LLM_UPSTREAM_API_KEY;
delete process.env.LLM_API_KEY;

export const REPO_ROOT = repoRoot;
export const TOY_REPO = path.join(repoRoot, "fixtures/toy-repo");
export const ADMIN_EMAIL = "admin";
export const ADMIN_PASSWORD = "123456";

export type Json = Record<string, unknown>;

export type CoreApi = {
  base: string;
  server: Server;
  close(): Promise<void>;
};

export function jsonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

export async function startCoreApi(): Promise<CoreApi> {
  const { createApiServer } = await import("../../../packages/control-plane/src/api/server.js");
  const { listen, close } = await import("../../../packages/control-plane/src/e2e/helpers.js");
  const { ensureDefaultAdmin } = await import("../../../packages/control-plane/src/accounts/accounts.js");
  const server = createApiServer();
  const port = await listen(server);
  await ensureDefaultAdmin();
  return {
    base: `http://127.0.0.1:${port}`,
    server,
    close: () => close(server),
  };
}

export async function login(
  base: string,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<{ token: string; user: { id: string; email: string } }> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson<{ token?: string; user?: { id: string; email: string }; error?: string }>(response);
  assert.equal(response.status, 200, body.error ?? `login failed for ${email}`);
  assert.ok(body.token && body.user, "login response missing token/user");
  return { token: body.token, user: body.user };
}

export async function createMate(base: string): Promise<{ token: string; user: { id: string; email: string }; password: string }> {
  const { createTeammateAccount } = await import("../../../packages/control-plane/src/accounts/accounts.js");
  const loginName = `m${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const password = "matepass";
  const created = await createTeammateAccount({ email: loginName, password, orgId: "org_local" });
  const session = await login(base, created.email, password);
  return { ...session, password };
}

export async function createRun(
  base: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      prompt: "core e2e run",
      repoUrls: [TOY_REPO],
      source: "api",
      ...body,
    }),
  });
}

export async function createRunOk(
  base: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ id: string; status: string }> {
  const response = await createRun(base, token, body);
  const json = await readJson<{ id?: string; status?: string; error?: string }>(response);
  assert.equal(response.status, 201, json.error ?? "create run failed");
  assert.ok(json.id);
  return { id: json.id, status: json.status ?? "" };
}

export function uniquePhone(): string {
  const n = Date.now().toString().slice(-8);
  return `139${n}`;
}

export function uniqueUsername(): string {
  return `u${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
