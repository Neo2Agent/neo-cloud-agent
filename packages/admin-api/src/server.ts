import "./cookie-env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { publicLlmSettings, readLlmSettings } from "@neo-cloud-agent/contracts";
import {
  AccountError,
  loginAccount,
  logoutSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../../control-plane/src/accounts/accounts.js";
import {
  adminOverviewPayload,
  adminRunsLimit,
  adminRunsPayload,
  adminUsersPayload,
} from "../../control-plane/src/admin/overview.js";
import { actorIsPlatformAdmin, isAdminLogin } from "../../control-plane/src/security/actor.js";
import { readApiCredential, readBearer, resolveActor } from "../../control-plane/src/security/auth.js";
import { clientIp, rateLimitSnapshot } from "../../control-plane/src/security/rate-limit-http.js";
import { adminPlatformInfo, loadAdminCounts, loadAdminRuns, startAdminData } from "./data.js";
import { serveAdminWeb } from "./static.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type, Authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
} as const;

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

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

function sendAuthSession(res: ServerResponse, status: number, created: { user: { email: string }; token: string }): void {
  const json = JSON.stringify({ ok: true, token: created.token, user: created.user, admin: true });
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "set-cookie": sessionCookieHeader(created.token),
  });
  res.end(json);
}

export function createAdminApiServer() {
  void startAdminData().catch((error) => {
    console.error("admin-api platform init failed", error);
  });
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://admin-api.local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (method === "GET" && path === "/health") {
        send(res, 200, {
          ok: true,
          service: "admin-api",
          ...adminPlatformInfo(),
        });
        return;
      }
      if (method === "POST" && path === "/v1/auth/login") {
        const body = (await readJson(req)) as { email?: string; password?: string };
        try {
          const created = await loginAccount(body);
          if (!isAdminLogin(created.user.email)) {
            await logoutSession(created.token);
            send(res, 403, { error: "admin_required" });
            return;
          }
          sendAuthSession(res, 200, created);
        } catch (error) {
          if (error instanceof AccountError) {
            send(res, error.status, { error: error.message });
            return;
          }
          send(res, 401, { error: error instanceof Error ? error.message : "unauthorized" });
        }
        return;
      }
      if (method === "POST" && path === "/v1/auth/logout") {
        await logoutSession(readBearer(req) ?? readApiCredential(req, url));
        res.writeHead(200, { ...CORS, "content-type": "application/json; charset=utf-8", "set-cookie": clearSessionCookieHeader() });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (serveAdminWeb(req, res)) {
        return;
      }
      const actor = await resolveActor(req, url);
      if (!actor || !actorIsPlatformAdmin(actor)) {
        send(res, actor ? 403 : 401, { error: actor ? "admin_required" : "unauthorized" });
        return;
      }
      if (method === "GET" && path === "/v1/me") {
        send(res, 200, {
          user: actor.kind === "user" ? { id: actor.userId, email: actor.email, orgId: actor.orgId } : null,
          actor: actor.kind,
          admin: true,
        });
        return;
      }
      if (method === "GET" && path === "/v1/admin/overview") {
        send(
          res,
          200,
          await adminOverviewPayload(await loadAdminRuns(), publicLlmSettings(readLlmSettings()), {
            platform: adminPlatformInfo(),
            counts: await loadAdminCounts(),
          }),
        );
        return;
      }
      if (method === "GET" && path === "/v1/admin/users") {
        send(res, 200, await adminUsersPayload(await loadAdminRuns()));
        return;
      }
      if (method === "GET" && path === "/v1/admin/runs") {
        send(res, 200, adminRunsPayload(await loadAdminRuns(), adminRunsLimit(url.searchParams.get("limit"))));
        return;
      }
      if (method === "GET" && path === "/v1/rate-limits") {
        send(res, 200, await rateLimitSnapshot(actor, clientIp(req)));
        return;
      }
      send(res, 404, { error: "not_found" });
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : "admin_api_error" });
    }
  });
}
