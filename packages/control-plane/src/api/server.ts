import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  CreateBuildRequest,
  CreateCommitRequest,
  CreateEnvironmentRequest,
  CreateFollowUpRequest,
  CreateGitTokenRequest,
  CreatePullRequestRequest,
  CreateRunRequest,
  CreateSubscriptionRequest,
  CreateAutomationRequest,
  CreateDeskRequest,
  CreateProjectRequest,
  CreateTodoRequest,
  HandoffRequest,
  TransitionTodoRequest,
  UpdateTodoRequest,
  RunEvent,
  UpdateProjectRequest,
} from "@neo-cloud-agent/contracts";
import {
  canManageProject,
  evaluateEgress,
  pageTranscriptSnapshot,
  parseAutomationSchedule,
  parseLlmSettingsRequest,
  publicLlmSettings,
  readLlmSettings,
  resolveModelLimits,
  writeLlmSettings,
} from "@neo-cloud-agent/contracts";
import { eventsForRun } from "../events/bus.js";
import { snapshotForRun } from "../events/snapshot.js";
import { attachEventStream } from "../events/stream.js";
import {
  abortRun,
  archiveRun,
  claimDeskRun,
  commitRun,
  createRun,
  enqueueFollowUp,
  inviteRunCollaborator,
  canInviteRunCollaborator,
  handoffRun,
  leaseDesk,
  ingestGitHubWebhook,
  getBootstrap,
  getRun,
  getRunDiagnostics,
  getRunDiff,
  getRunSession,
  ingestEvents,
  listFollowUps,
  listProjectRunCards,
  listRunSubscriptions,
  listRuns,
  removeRunCollaborator,
  subscribeRun,
  transferRun,
  loadRunIntoMemory,
  mintRunGitToken,
  openRunDraftPr,
  recoverLiveWorkers,
  restoreArchivedRun,
  saveRunSession,
  startWorkerLeaseWatch,
  takeInbound,
} from "../orchestrator/orchestrator.js";
import { listWorkspacePath } from "../workspace-fs.js";
import { workspaceFor } from "../worker-spawn.js";
import {
  AccountError,
  bootstrapEmail,
  createTeammateAccount,
  findPublicUserByEmail,
  findPublicUserById,
  loginAccount,
  logoutSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../accounts/accounts.js";
import { defaultWorkerResources, getConfig } from "../config.js";
import { publicScmSettings, writeScmSettings } from "../scm/settings.js";
import { getObjectStore } from "../objects/store.js";
import { startPlatform, platformInfo } from "../platform.js";
import {
  accessRequired,
  accountsRequired,
  cookieHeader,
  matchApiToken,
  readBearer,
  resolveActor,
  resolveApiToken,
  verifyWorkerJwt,
} from "../security/auth.js";
import { actorCanAccessRun, type Actor } from "../security/actor.js";
import { createEnvironmentBuild, getBuild, listBuilds, listBuildsForEnv, readBuildLogs } from "../env/builds.js";
import { createEnvironment, getEnvironment, listEnvironments } from "../env/store.js";
import { readyWarmCount } from "../env/warm-pool.js";
import { listRunArtifacts, putRunArtifact, readRunArtifact } from "../artifacts/artifacts.js";
import { verifyArtifactAccess } from "../artifacts/signed.js";
import { beginMcpOAuth, finishMcpOAuth } from "../mcp/oauth.js";
import { proxyMcpCall, proxyMcpList } from "../mcp/proxy.js";
import { deleteMcpSecret, publicMcpServers, upsertMcpSecret } from "../mcp/secrets.js";
import { publicAppUrl } from "../notify/settings.js";
import { quotaSnapshot, QuotaError, writeQuotaLimits } from "../quota/quota.js";
import { GITHUB_WEBHOOK_PATH, publicGitHubWebhookInfo } from "../subscriptions/secret.js";
import { createAutomation, deleteAutomation, listAutomations, updateAutomation } from "../automations/store.js";
import {
  acceptInvite,
  addProjectMember,
  approveInvite,
  createInvite,
  createProject,
  findInvite,
  getProject,
  listProjects,
  listProjectsForUser,
  memberRole,
  updateProject,
} from "../projects/store.js";
import {
  addTodoComment,
  createTodo,
  getTodo,
  listTodoComments,
  listTodos,
  transitionTodo,
  updateTodo,
} from "../projects/todos.js";
import { createDesk, deleteDesk, findDeskByToken, listDesks } from "../desks/store.js";
import { ingestTelegramWebhook, ingestWeChatXml, verifyWeChatQuery } from "../ingress/chat.js";
import {
  publicNotifySettings,
  TELEGRAM_WEBHOOK_PATH,
  WECHAT_WEBHOOK_PATH,
  writeNotifySettings,
} from "../notify/settings.js";
import { registerTelegramWebhook } from "../notify/telegram.js";
import { serveWebFile } from "./static.js";
import { guestFacingBootstrap } from "../runtime/firecracker.js";
import { ensureVmSlots, kvmAvailable, summarizeVmSlots } from "../runtime/vm-slots.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Last-Event-ID, Content-Type, Authorization",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
} as const;

async function requireRun(runId: string) {
  return getRun(runId) ?? (await loadRunIntoMemory(runId)) ?? (await restoreArchivedRun(runId));
}

function denyUnless(run: { userId: string } | null | undefined, actor: Actor, res: ServerResponse): boolean {
  if (!run || !actorCanAccessRun(actor, run)) {
    notFound(res);
    return false;
  }
  return true;
}

function sendAuthSession(res: ServerResponse, status: number, created: { user: unknown; token: string }): void {
  const json = JSON.stringify({ ok: true, token: created.token, user: created.user, authRequired: true });
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "set-cookie": sessionCookieHeader(created.token),
  });
  res.end(json);
}

function sendAccountError(res: ServerResponse, error: unknown): void {
  if (error instanceof AccountError) {
    send(res, error.status, { error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "account_error";
  send(res, message.includes("already registered") ? 409 : 500, { error: message });
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (raw.length === 0) {
    return {};
  }
  return JSON.parse(raw.toString("utf8"));
}

function sendPlain(res: ServerResponse, status: number, body: string, contentType = "text/plain"): void {
  res.writeHead(status, {
    ...CORS,
    "content-type": `${contentType}; charset=utf-8`,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function sendArtifactBody(res: ServerResponse, runId: string, name: string): Promise<boolean> {
  const file = await readRunArtifact(runId, name);
  if (!file) {
    return false;
  }
  res.writeHead(200, {
    ...CORS,
    "content-type": file.artifact.contentType,
    "content-length": file.body.length,
    "cache-control": "private, max-age=60",
    "content-disposition": `inline; filename="${file.artifact.name}"`,
  });
  res.end(file.body);
  return true;
}

function requestOrigin(req: IncomingMessage): string {
  const configured = publicAppUrl();
  if (configured) {
    return configured;
  }
  const host = headerValue(req.headers.host);
  const proto = headerValue(req.headers["x-forwarded-proto"]) || "http";
  return host ? `${proto}://${host}` : getConfig().controlPlaneUrl;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function notFound(res: ServerResponse): void {
  send(res, 404, { error: "not_found" });
}

export function createApiServer() {
  void startPlatform()
    .catch((error) => {
      console.error("platform init failed", error);
    })
    .then(() => recoverLiveWorkers());
  startWorkerLeaseWatch();
  if (getConfig().workerRuntime === "vm" && !process.env.NODE_TEST_CONTEXT) {
    void ensureVmSlots().catch((error) => {
      console.error("vm slots init failed", error);
    });
  }
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://control-plane.local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }

      if (method === "GET" && path === "/health") {
        const config = getConfig();
        const llm = publicLlmSettings(readLlmSettings());
        send(res, 200, {
          ok: true,
          service: "control-plane",
          defaultModel: config.defaultModel,
          llmUpstream: llm.configured ? llm.upstream : (config.llmUpstream ?? "mock"),
          llmModel: llm.model,
          llmContextWindow: resolveModelLimits(llm.model)?.contextWindow ?? null,
          llmConfigured: llm.configured,
          workerRuntime: config.workerRuntime,
          spawnLocalWorker: config.spawnLocalWorker,
          vmSlots: summarizeVmSlots(config.workerRuntime),
          objectStore: getObjectStore().kind,
          scmPush: publicScmSettings(),
          workerMemoryMiB: defaultWorkerResources(config.workerRuntime).memoryMiB,
          authRequired: accessRequired(),
          accountsEnabled: true,
          accountsRequired: accountsRequired(),
          bootstrapEmail: bootstrapEmail(),
          bootstrapLogin: false,
          defaultAdmin: bootstrapEmail() === "admin",
          warmPoolReady: readyWarmCount(),
          builds: listBuilds().filter((item) => item.status === "SUCCEEDED" && !item.draft).length,
          ...platformInfo(),
          githubWebhook: publicGitHubWebhookInfo(),
          notify: publicNotifySettings(),
          automations: listAutomations().length,
          projects: listProjects().length,
        });
        return;
      }

      if (path === GITHUB_WEBHOOK_PATH && (method === "GET" || method === "POST")) {
        if (method === "GET") {
          send(res, 200, { ok: true, ...publicGitHubWebhookInfo() });
          return;
        }
        const raw = await readRawBody(req);
        const result = await ingestGitHubWebhook({
          eventName: headerValue(req.headers["x-github-event"]) || "unknown",
          deliveryId: headerValue(req.headers["x-github-delivery"]),
          signature: req.headers["x-hub-signature-256"],
          raw,
        });
        send(res, result.status, result.body);
        return;
      }

      if (path === TELEGRAM_WEBHOOK_PATH && method === "POST") {
        const raw = await readRawBody(req);
        let payload: unknown = {};
        if (raw.length > 0) {
          try {
            payload = JSON.parse(raw.toString("utf8")) as unknown;
          } catch {
            send(res, 400, { error: "invalid_json" });
            return;
          }
        }
        const result = await ingestTelegramWebhook({
          secretHeader: req.headers["x-telegram-bot-api-secret-token"],
          payload,
        });
        send(res, result.status, result.body);
        return;
      }

      if (path === WECHAT_WEBHOOK_PATH && (method === "GET" || method === "POST")) {
        const verified = verifyWeChatQuery(url.searchParams);
        if (!verified.ok) {
          send(res, 401, { error: "invalid_signature" });
          return;
        }
        if (method === "GET") {
          sendPlain(res, 200, verified.echo ?? "");
          return;
        }
        const raw = await readRawBody(req);
        const result = await ingestWeChatXml(raw.toString("utf8"));
        sendPlain(res, result.status, result.xml, "application/xml");
        return;
      }

      if (method === "GET" && path === "/oauth/callback/mcp") {
        try {
          const name = await finishMcpOAuth({
            code: url.searchParams.get("code") ?? "",
            state: url.searchParams.get("state") ?? "",
            origin: requestOrigin(req),
          });
          sendPlain(res, 200, `<!doctype html><title>MCP</title><p>已连接 ${name}。可以关掉这个标签。</p>`, "text/html");
        } catch (error) {
          const message = error instanceof Error ? error.message : "oauth_failed";
          sendPlain(res, 400, `<!doctype html><title>MCP</title><p>${message}</p>`, "text/html");
        }
        return;
      }

      const signedArtifact = /^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/.exec(path);
      if (method === "GET" && signedArtifact) {
        const runId = signedArtifact[1] ?? "";
        const name = decodeURIComponent(signedArtifact[2] ?? "");
        const token = url.searchParams.get("token") ?? "";
        if (token && verifyArtifactAccess(token, runId, name)) {
          if (!(await sendArtifactBody(res, runId, name))) {
            notFound(res);
          }
          return;
        }
      }

      if (method === "POST" && path === "/v1/auth/register") {
        send(res, 403, { error: "不支持注册" });
        return;
      }

      if (method === "POST" && path === "/v1/auth/login") {
        const body = (await readJson(req)) as { email?: string; password?: string };
        try {
          const created = await loginAccount(body);
          sendAuthSession(res, 200, created);
        } catch (error) {
          sendAccountError(res, error);
        }
        return;
      }

      if (method === "POST" && path === "/v1/auth/bootstrap") {
        send(res, 403, { error: "请使用账号登录" });
        return;
      }

      if (method === "POST" && path === "/v1/auth/logout") {
        const actor = await resolveActor(req, url);
        const token = req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice("Bearer ".length).trim()
          : null;
        await logoutSession(token);
        const json = JSON.stringify({ ok: true });
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(json),
          "set-cookie": clearSessionCookieHeader(),
        });
        res.end(json);
        void actor;
        return;
      }

      if (method === "POST" && path === "/v1/auth") {
        const expected = resolveApiToken();
        if (!expected) {
          send(res, accessRequired() ? 401 : 200, { ok: !accessRequired(), authRequired: accessRequired() });
          return;
        }
        const body = (await readJson(req)) as { token?: string };
        const token = (body.token ?? "").trim();
        if (!matchApiToken(token)) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        const json = JSON.stringify({ ok: true, authRequired: true });
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(json),
          "set-cookie": cookieHeader(token),
        });
        res.end(json);
        return;
      }

      if (path.startsWith("/internal/")) {
        const runId = /^\/internal\/runs\/([^/]+)/.exec(path)?.[1];
        if (runId && !verifyWorkerJwt(req, runId)) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
      } else if (path.startsWith("/v1/")) {
        const deskAction = /^\/v1\/desks\/([^/]+)\/(lease|claim)$/.exec(path);
        if (deskAction && method === "POST") {
          const deskId = deskAction[1] ?? "";
          const action = deskAction[2];
          const token = readBearer(req);
          const desk = token ? findDeskByToken(token) : undefined;
          if (!desk || desk.id !== deskId) {
            send(res, 401, { error: "unauthorized" });
            return;
          }
          try {
            if (action === "lease") {
              const body = (await readJson(req)) as { waitMs?: number };
              send(res, 200, await leaseDesk(deskId, Number(body.waitMs ?? 20_000)));
              return;
            }
            const body = (await readJson(req)) as { runId?: string; workspaceDir?: string; pid?: number };
            if (!body.runId || !body.workspaceDir) {
              send(res, 400, { error: "runId and workspaceDir are required" });
              return;
            }
            send(res, 200, await claimDeskRun(deskId, { runId: body.runId, workspaceDir: body.workspaceDir, pid: body.pid }));
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "desk_action_failed" });
          }
          return;
        }
        const actor = await resolveActor(req, url);
        if (!actor) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        if (method === "GET" && path === "/v1/me") {
          send(res, 200, { user: actor.kind === "user" ? { id: actor.userId, email: actor.email, orgId: actor.orgId } : null, actor: actor.kind });
          return;
        }
        if (method === "GET" && path === "/v1/vms") {
          send(res, 200, summarizeVmSlots(getConfig().workerRuntime));
          return;
        }
        if (method === "GET" && path === "/v1/settings/llm") {
          send(res, 200, publicLlmSettings(readLlmSettings()));
          return;
        }
        if (method === "POST" && path === "/v1/settings/llm") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(res, 200, writeLlmSettings(parseLlmSettingsRequest(await readJson(req))));
          } catch (error) {
            const message = error instanceof Error ? error.message : "invalid_llm_settings";
            send(res, 400, { error: message });
          }
          return;
        }
        if (method === "GET" && path === "/v1/settings/scm") {
          send(res, 200, publicScmSettings());
          return;
        }
        if (method === "POST" && path === "/v1/settings/scm") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as { token?: string; clear?: boolean };
            send(res, 200, writeScmSettings(body));
          } catch (error) {
            const message = error instanceof Error ? error.message : "invalid_scm_settings";
            send(res, 400, { error: message });
          }
          return;
        }
        if (method === "GET" && path === "/v1/settings/notify") {
          send(res, 200, publicNotifySettings());
          return;
        }
        if (method === "POST" && path === "/v1/settings/notify") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as {
              telegramBotToken?: string;
              telegramChatId?: string;
              wecomWebhook?: string;
              httpUrl?: string;
              wechatToken?: string;
              defaultRepo?: string;
              smtpHost?: string;
              smtpPort?: string | number;
              smtpUser?: string;
              smtpPass?: string;
              smtpFrom?: string;
              emailTo?: string;
              clear?: boolean;
            };
            const saved = writeNotifySettings(body);
            if (body.telegramBotToken) {
              void registerTelegramWebhook().catch(() => undefined);
            }
            send(res, 200, saved);
          } catch (error) {
            const message = error instanceof Error ? error.message : "invalid_notify_settings";
            send(res, 400, { error: message });
          }
          return;
        }
        if (method === "GET" && path === "/v1/quota") {
          send(res, 200, quotaSnapshot(listRuns(), actor.orgId));
          return;
        }
        if (method === "GET" && path === "/v1/settings/quota") {
          send(res, 200, quotaSnapshot(listRuns(), actor.orgId));
          return;
        }
        if (method === "POST" && path === "/v1/settings/quota") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as { maxTokensMonth?: number; maxConcurrentRuns?: number };
            writeQuotaLimits(body);
            send(res, 200, quotaSnapshot(listRuns(), actor.orgId));
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "invalid_quota" });
          }
          return;
        }
        if (method === "GET" && path === "/v1/settings/mcp") {
          send(res, 200, { servers: publicMcpServers() });
          return;
        }
        if (method === "POST" && path === "/v1/settings/mcp") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as {
              name?: string;
              bearer?: string;
              headers?: Record<string, string>;
              oauth?: {
                authorizeUrl?: string;
                tokenUrl?: string;
                clientId?: string;
                clientSecret?: string;
                scopes?: string;
              };
              clear?: boolean;
            };
            const name = (body.name ?? "").trim();
            if (body.clear) {
              send(res, 200, { servers: deleteMcpSecret(name) });
              return;
            }
            if (!name) {
              send(res, 400, { error: "MCP server name is required" });
              return;
            }
            const headers = { ...(body.headers ?? {}) };
            if (body.bearer?.trim()) {
              headers.authorization = body.bearer.trim().startsWith("Bearer ")
                ? body.bearer.trim()
                : `Bearer ${body.bearer.trim()}`;
            }
            send(res, 200, {
              servers: upsertMcpSecret(name, {
                headers: Object.keys(headers).length > 0 ? headers : undefined,
                oauth: body.oauth,
              }),
            });
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "invalid_mcp_settings" });
          }
          return;
        }
        const mcpOAuthStart = /^\/v1\/oauth\/mcp\/([^/]+)\/start$/.exec(path);
        if (mcpOAuthStart && method === "GET") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const started = beginMcpOAuth(decodeURIComponent(mcpOAuthStart[1] ?? ""), requestOrigin(req));
            send(res, 200, started);
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "oauth_start_failed" });
          }
          return;
        }
        if (method === "GET" && path === "/v1/automations") {
          send(res, 200, { automations: listAutomations() });
          return;
        }
        if (method === "POST" && path === "/v1/automations") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(
              res,
              201,
              createAutomation((await readJson(req)) as CreateAutomationRequest, {
                userId: actor.userId,
                orgId: actor.orgId,
              }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "invalid_automation";
            send(res, 400, { error: message });
          }
          return;
        }
        const automationMatch = /^\/v1\/automations\/([^/]+)$/.exec(path);
        if (automationMatch && method === "POST") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          const body = (await readJson(req)) as {
            name?: string;
            prompt?: string;
            repoUrls?: string[];
            enabled?: boolean;
            schedule?: unknown;
            delete?: boolean;
          };
          if (body.delete) {
            send(res, deleteAutomation(automationMatch[1] ?? "") ? 200 : 404, { ok: true });
            return;
          }
          let schedule = undefined;
          if (body.schedule !== undefined) {
            try {
              schedule = parseAutomationSchedule(body.schedule);
            } catch (error) {
              const message = error instanceof Error ? error.message : "invalid_schedule";
              send(res, 400, { error: message });
              return;
            }
          }
          const updated = updateAutomation(automationMatch[1] ?? "", {
            name: body.name,
            prompt: body.prompt,
            repoUrls: body.repoUrls,
            enabled: body.enabled,
            schedule,
          });
          if (!updated) {
            notFound(res);
            return;
          }
          send(res, 200, updated);
          return;
        }
        if (method === "GET" && path === "/v1/projects") {
          if (actor.kind !== "user") {
            send(res, 200, { projects: [] });
            return;
          }
          send(res, 200, { projects: listProjectsForUser(actor.userId) });
          return;
        }
        if (method === "POST" && path === "/v1/projects") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as CreateProjectRequest;
            send(res, 201, createProject({ ...body, actor: { userId: actor.userId, email: actor.email } }));
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "invalid_project" });
          }
          return;
        }
        const inviteLookup = /^\/v1\/invites\/([^/]+)$/.exec(path);
        if (inviteLookup && method === "GET") {
          const found = findInvite(inviteLookup[1] ?? "");
          if (!found) {
            notFound(res);
            return;
          }
          send(res, 200, {
            projectId: found.project.id,
            projectName: found.project.name,
            invitePolicy: found.project.invitePolicy,
            status: found.invite.status,
            expiresAt: found.invite.expiresAt,
          });
          return;
        }
        if (inviteLookup && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(res, 200, acceptInvite(inviteLookup[1] ?? "", { userId: actor.userId, email: actor.email }));
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "invite_failed" });
          }
          return;
        }
        const projectMatch = /^\/v1\/projects\/([^/]+)$/.exec(path);
        if (projectMatch && method === "GET") {
          const project = getProject(projectMatch[1] ?? "");
          if (!project || (actor.kind === "user" && !memberRole(project.id, actor.userId))) {
            notFound(res);
            return;
          }
          send(res, 200, project);
          return;
        }
        if (projectMatch && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(
              res,
              200,
              updateProject(projectMatch[1] ?? "", (await readJson(req)) as UpdateProjectRequest, {
                userId: actor.userId,
                email: actor.email,
              }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "update_failed";
            send(res, message.includes("不存在") ? 404 : 400, { error: message });
          }
          return;
        }
        const projectInviteMatch = /^\/v1\/projects\/([^/]+)\/invites$/.exec(path);
        if (projectInviteMatch && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const invite = createInvite(projectInviteMatch[1] ?? "", { userId: actor.userId, email: actor.email });
            const app = publicNotifySettings().publicAppUrl.replace(/\/$/, "");
            send(res, 201, { ...invite, url: `${app || ""}/#/invite/${invite.token}` });
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "invite_failed" });
          }
          return;
        }
        const projectApproveMatch = /^\/v1\/projects\/([^/]+)\/invites\/([^/]+)\/approve$/.exec(path);
        if (projectApproveMatch && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(
              res,
              200,
              approveInvite(projectApproveMatch[1] ?? "", projectApproveMatch[2] ?? "", {
                userId: actor.userId,
                email: actor.email,
              }),
            );
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "approve_failed" });
          }
          return;
        }
        const todoCommentsMatch = /^\/v1\/projects\/([^/]+)\/todos\/([^/]+)\/comments$/.exec(path);
        if (todoCommentsMatch && actor.kind === "user" && (method === "GET" || method === "POST")) {
          try {
            const projectId = todoCommentsMatch[1] ?? "";
            const todoId = todoCommentsMatch[2] ?? "";
            if (method === "GET") {
              send(res, 200, { comments: listTodoComments(projectId, todoId, actor.userId) });
              return;
            }
            const body = (await readJson(req)) as { body?: string };
            send(res, 201, addTodoComment(projectId, todoId, body.body ?? "", { userId: actor.userId, email: actor.email }));
          } catch (error) {
            const message = error instanceof Error ? error.message : "todo_comment_failed";
            send(res, message.includes("不存在") ? 404 : 400, { error: message });
          }
          return;
        }
        const todoTransitionMatch = /^\/v1\/projects\/([^/]+)\/todos\/([^/]+)\/transition$/.exec(path);
        if (todoTransitionMatch && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            const body = (await readJson(req)) as TransitionTodoRequest;
            send(
              res,
              200,
              transitionTodo(todoTransitionMatch[1] ?? "", todoTransitionMatch[2] ?? "", body.status, { userId: actor.userId, email: actor.email }, body.pauseReason),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "todo_transition_failed";
            send(res, message.includes("不存在") ? 404 : 400, { error: message });
          }
          return;
        }
        const todoItemMatch = /^\/v1\/projects\/([^/]+)\/todos\/([^/]+)$/.exec(path);
        if (todoItemMatch && actor.kind === "user" && (method === "GET" || method === "POST")) {
          try {
            const projectId = todoItemMatch[1] ?? "";
            const todoId = todoItemMatch[2] ?? "";
            if (method === "GET") {
              const todo = getTodo(projectId, todoId, actor.userId);
              if (!todo) {
                notFound(res);
                return;
              }
              send(res, 200, todo);
              return;
            }
            send(
              res,
              200,
              updateTodo(projectId, todoId, (await readJson(req)) as UpdateTodoRequest, { userId: actor.userId, email: actor.email }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "todo_failed";
            send(res, message.includes("不存在") ? 404 : 400, { error: message });
          }
          return;
        }
        const todosMatch = /^\/v1\/projects\/([^/]+)\/todos$/.exec(path);
        if (todosMatch && actor.kind === "user" && (method === "GET" || method === "POST")) {
          try {
            const projectId = todosMatch[1] ?? "";
            if (method === "GET") {
              send(res, 200, { todos: listTodos(projectId, actor.userId) });
              return;
            }
            send(
              res,
              201,
              createTodo(projectId, (await readJson(req)) as CreateTodoRequest, { userId: actor.userId, email: actor.email }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "todo_failed";
            send(res, message.includes("不存在") ? 404 : 400, { error: message });
          }
          return;
        }
        const projectRunsMatch = /^\/v1\/projects\/([^/]+)\/runs$/.exec(path);
        if (projectRunsMatch && method === "GET") {
          const project = getProject(projectRunsMatch[1] ?? "");
          if (!project || (actor.kind === "user" && !memberRole(project.id, actor.userId))) {
            notFound(res);
            return;
          }
          const userId = actor.kind === "user" ? actor.userId : "";
          send(res, 200, { runs: listProjectRunCards(project.id, userId) });
          return;
        }
        const projectMemberMatch = /^\/v1\/projects\/([^/]+)\/members$/.exec(path);
        if (projectMemberMatch && method === "POST") {
          if (actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          const projectId = projectMemberMatch[1] ?? "";
          if (!canManageProject(memberRole(projectId, actor.userId))) {
            send(res, 403, { error: "没有权限加成员" });
            return;
          }
          try {
            const body = (await readJson(req)) as { email?: string; password?: string; role?: "admin" | "member" };
            const email = (body.email ?? "").trim();
            let user = await findPublicUserByEmail(email);
            if (!user) {
              if (!body.password) {
                send(res, 400, { error: "新成员需要设置密码" });
                return;
              }
              user = await createTeammateAccount({ email, password: body.password, orgId: actor.orgId });
            }
            send(
              res,
              200,
              addProjectMember(projectId, { userId: user.id, email: user.email, role: body.role }, { userId: actor.userId, email: actor.email }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "member_failed";
            send(res, message.includes("已存在") ? 409 : 400, { error: message });
          }
          return;
        }
        if (method === "GET" && path === "/v1/desks") {
          send(res, 200, { desks: listDesks(actor.kind === "user" ? actor.userId : undefined) });
          return;
        }
        if (method === "POST" && path === "/v1/desks") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          try {
            send(res, 201, createDesk((await readJson(req)) as CreateDeskRequest, { userId: actor.userId, orgId: actor.orgId }));
          } catch (error) {
            send(res, 400, { error: error instanceof Error ? error.message : "create_desk_failed" });
          }
          return;
        }
        const deskDelete = /^\/v1\/desks\/([^/]+)$/.exec(path);
        if (deskDelete && method === "DELETE") {
          if (actor.kind === "anonymous") {
            send(res, 401, { error: "login_required" });
            return;
          }
          const ok = deleteDesk(deskDelete[1] ?? "", actor.kind === "user" ? actor.userId : undefined);
          send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
          return;
        }
        if (method === "POST" && path === "/v1/runs") {
          const body = (await readJson(req)) as CreateRunRequest;
          if (!body.prompt || !Array.isArray(body.repoUrls)) {
            send(res, 400, { error: "prompt and repoUrls are required" });
            return;
          }
          try {
            send(
              res,
              201,
              await createRun(body, {
                userId: actor.kind === "user" ? actor.userId : undefined,
                orgId: actor.orgId,
                email: actor.kind === "user" ? actor.email : undefined,
              }),
            );
          } catch (error) {
            if (error instanceof QuotaError) {
              send(res, 429, { error: error.message });
              return;
            }
            send(res, 400, { error: error instanceof Error ? error.message : "create_run_failed" });
          }
          return;
        }
        if (method === "GET" && path === "/v1/runs") {
          send(res, 200, { runs: listRuns().filter((run) => actorCanAccessRun(actor, run)) });
          return;
        }
        Object.assign(req, { neoActor: actor });
      }

      const actor = ((req as IncomingMessage & { neoActor?: Actor }).neoActor ?? (await resolveActor(req, url))) as Actor | null;

      const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(path);
      if (runMatch && method === "GET") {
        const run = await requireRun(runMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, run);
        return;
      }

      const followMatch = /^\/v1\/runs\/([^/]+)\/follow-ups$/.exec(path);
      if (followMatch && method === "POST") {
        const runId = followMatch[1] ?? "";
        const run = await requireRun(runId);
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        const body = (await readJson(req)) as CreateFollowUpRequest;
        if (!body.text) {
          send(res, 400, { error: "text is required" });
          return;
        }
        send(
          res,
          201,
          await enqueueFollowUp(
            runId,
            body,
            actor.kind === "user" ? { userId: actor.userId, email: actor.email } : undefined,
          ),
        );
        return;
      }
      if (followMatch && method === "GET") {
        const run = await requireRun(followMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, { followUps: listFollowUps(followMatch[1] ?? "") });
        return;
      }

      const subscriptionMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/subscriptions$/.exec(path);
      if (subscriptionMatch && (method === "GET" || method === "POST")) {
        const runId = subscriptionMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        if (method === "GET") {
          send(res, 200, { subscriptions: listRunSubscriptions(runId), webhook: publicGitHubWebhookInfo() });
          return;
        }
        try {
          const body = (await readJson(req)) as CreateSubscriptionRequest;
          send(res, 201, subscribeRun(runId, body));
        } catch (error) {
          const message = error instanceof Error ? error.message : "subscribe failed";
          send(res, message.includes("not found") ? 404 : 400, { error: message });
        }
        return;
      }

      const handoffMatch = /^\/v1\/runs\/([^/]+)\/handoff$/.exec(path);
      if (handoffMatch && method === "POST") {
        const run = await requireRun(handoffMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        try {
          send(res, 200, await handoffRun(handoffMatch[1] ?? "", (await readJson(req)) as HandoffRequest));
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "handoff_failed" });
        }
        return;
      }

      const abortMatch = /^\/v1\/runs\/([^/]+)\/abort$/.exec(path);
      if (abortMatch && method === "POST") {
        const run = await requireRun(abortMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, abortRun(abortMatch[1] ?? ""));
        return;
      }

      const collaboratorsMatch = /^\/v1\/runs\/([^/]+)\/collaborators$/.exec(path);
      if (collaboratorsMatch && (method === "GET" || method === "POST")) {
        const run = await requireRun(collaboratorsMatch[1] ?? "");
        if (!run || !actor || actor.kind !== "user") {
          if (actor && actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          notFound(res);
          return;
        }
        if (!actorCanAccessRun(actor, run) && !canInviteRunCollaborator(run, actor)) {
          notFound(res);
          return;
        }
        if (method === "GET") {
          send(res, 200, { collaborators: run.collaborators ?? [] });
          return;
        }
        try {
          const body = (await readJson(req)) as { userId?: string; email?: string };
          let user = body.userId ? await findPublicUserById(body.userId) : null;
          if (!user && body.email) {
            user = await findPublicUserByEmail(body.email);
          }
          if (!user) {
            send(res, 400, { error: "找不到这个账号" });
            return;
          }
          send(res, 200, inviteRunCollaborator(run.id, { userId: user.id, email: user.email }, { userId: actor.userId, email: actor.email }));
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "invite_failed" });
        }
        return;
      }
      const collaboratorDelete = /^\/v1\/runs\/([^/]+)\/collaborators\/([^/]+)$/.exec(path);
      if (collaboratorDelete && method === "DELETE") {
        const run = await requireRun(collaboratorDelete[1] ?? "");
        if (!run || !actor || actor.kind !== "user" || !actorCanAccessRun(actor, run)) {
          if (actor && actor.kind !== "user") {
            send(res, 401, { error: "login_required" });
            return;
          }
          notFound(res);
          return;
        }
        try {
          send(
            res,
            200,
            removeRunCollaborator(run.id, collaboratorDelete[2] ?? "", { userId: actor.userId, email: actor.email }),
          );
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "remove_failed" });
        }
        return;
      }

      const transferMatch = /^\/v1\/runs\/([^/]+)\/transfer$/.exec(path);
      if (transferMatch && method === "POST") {
        const run = await requireRun(transferMatch[1] ?? "");
        if (!run || !actor || !denyUnless(run, actor, res)) {
          return;
        }
        if (actor.kind !== "user") {
          send(res, 401, { error: "login_required" });
          return;
        }
        try {
          const body = (await readJson(req)) as { toUserId?: string; note?: string; mode?: "reassign" | "fork" };
          if (!body.toUserId) {
            send(res, 400, { error: "toUserId is required" });
            return;
          }
          send(
            res,
            200,
            await transferRun(run.id, body.toUserId, { userId: actor.userId, email: actor.email }, body.note, body.mode),
          );
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "transfer_failed" });
        }
        return;
      }

      const archiveMatch = /^\/v1\/runs\/([^/]+)\/archive$/.exec(path);
      if (archiveMatch && method === "POST") {
        const run = await requireRun(archiveMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, await archiveRun(archiveMatch[1] ?? ""));
        return;
      }

      const eventsMatch = /^\/v1\/runs\/([^/]+)\/events$/.exec(path);
      if (eventsMatch && method === "GET") {
        const runId = eventsMatch[1] ?? "";
        const run = await requireRun(runId);
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        attachEventStream(req, res, runId, url);
        return;
      }

      const inboxMatch = /^\/internal\/runs\/([^/]+)\/inbox$/.exec(path);
      if (inboxMatch && method === "POST") {
        send(res, 200, { messages: takeInbound(inboxMatch[1] ?? "") });
        return;
      }

      const bootstrapMatch = /^\/internal\/runs\/([^/]+)\/bootstrap$/.exec(path);
      if (bootstrapMatch && method === "GET") {
        const runId = bootstrapMatch[1] ?? "";
        const bootstrap = getBootstrap(runId);
        if (
          getConfig().workerRuntime === "firecracker" ||
          (getConfig().workerRuntime === "vm" && kvmAvailable())
        ) {
          send(res, 200, guestFacingBootstrap(runId, bootstrap, getConfig().workerControlPlaneUrl));
          return;
        }
        send(res, 200, bootstrap);
        return;
      }

      const egressMatch = /^\/internal\/runs\/([^/]+)\/egress-check$/.exec(path);
      if (egressMatch && method === "POST") {
        const runId = egressMatch[1] ?? "";
        const bootstrap = getBootstrap(runId);
        const body = (await readJson(req)) as { url?: string };
        if (!body.url) {
          send(res, 400, { error: "url is required" });
          return;
        }
        send(res, 200, evaluateEgress(bootstrap.egress, body.url));
        return;
      }

      const mcpProxyMatch = /^\/internal\/runs\/([^/]+)\/mcp$/.exec(path);
      if (mcpProxyMatch && method === "POST") {
        const runId = mcpProxyMatch[1] ?? "";
        try {
          const bootstrap = getBootstrap(runId);
          const body = (await readJson(req)) as {
            action?: "list" | "call";
            server?: string;
            tool?: string;
            arguments?: Record<string, unknown>;
          };
          if (body.action === "list") {
            send(res, 200, await proxyMcpList(runId, workspaceFor(runId), bootstrap.egress));
            return;
          }
          if (body.action === "call") {
            if (!body.server || !body.tool) {
              send(res, 400, { error: "server and tool are required" });
              return;
            }
            send(res, 200, {
              result: await proxyMcpCall(
                runId,
                { server: body.server, tool: body.tool, arguments: body.arguments },
                workspaceFor(runId),
                bootstrap.egress,
              ),
            });
            return;
          }
          send(res, 400, { error: "action must be list or call" });
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "mcp_proxy_failed" });
        }
        return;
      }

      const diagnosticsMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/diagnostics$/.exec(path);
      if (diagnosticsMatch && method === "GET") {
        const runId = diagnosticsMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        send(res, 200, getRunDiagnostics(runId));
        return;
      }

      const sessionMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/session$/.exec(path);
      if (sessionMatch && method === "GET") {
        const runId = sessionMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        send(res, 200, getRunSession(runId, { includeContent: path.startsWith("/internal/") }));
        return;
      }
      if (sessionMatch && method === "POST") {
        const runId = sessionMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as { files?: Array<{ name: string; content: string }> };
        send(res, 202, saveRunSession(runId, body.files ?? []));
        return;
      }

      const ingestMatch = /^\/internal\/runs\/([^/]+)\/events$/.exec(path);
      if (ingestMatch && method === "POST") {
        const runId = ingestMatch[1] ?? "";
        const body = (await readJson(req)) as { events?: RunEvent[] };
        ingestEvents(runId, body.events ?? []);
        send(res, 202, { ok: true });
        return;
      }

      const transcriptMatch = /^\/v1\/runs\/([^/]+)\/transcript$/.exec(path);
      if (transcriptMatch && method === "GET") {
        const runId = transcriptMatch[1] ?? "";
        const run = await requireRun(runId);
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        const includeEvents = url.searchParams.get("includeEvents") === "1";
        const before = url.searchParams.get("before");
        const limitParam = url.searchParams.get("limit");
        const full = snapshotForRun(runId);
        const snapshot = pageTranscriptSnapshot(full, {
          before,
          limit: includeEvents && !limitParam ? full.messages.length || 1 : limitParam ? Number(limitParam) : undefined,
        });
        send(res, 200, includeEvents ? { snapshot, events: eventsForRun(runId) } : { snapshot });
        return;
      }

      const commitMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/(?:scm\/)?commit$/.exec(path);
      if (commitMatch && method === "POST") {
        const runId = commitMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as CreateCommitRequest;
        send(res, 201, await commitRun(runId, body));
        return;
      }

      const prMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/(?:scm\/)?pull-request$/.exec(path);
      if (prMatch && method === "POST") {
        const runId = prMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as CreatePullRequestRequest;
        send(res, 201, await openRunDraftPr(runId, body));
        return;
      }

      const artifactsMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/artifacts$/.exec(path);
      if (artifactsMatch && method === "GET") {
        const runId = artifactsMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        send(res, 200, { artifacts: await listRunArtifacts(runId) });
        return;
      }
      if (artifactsMatch && method === "POST") {
        const runId = artifactsMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as {
          name?: string;
          content?: string;
          contentType?: string;
          encoding?: "utf8" | "base64";
        };
        if (!body.name || typeof body.content !== "string") {
          send(res, 400, { error: "name and content are required" });
          return;
        }
        try {
          send(res, 201, await putRunArtifact(runId, {
            name: body.name,
            content: body.content,
            contentType: body.contentType,
            encoding: body.encoding,
          }));
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "upload failed" });
        }
        return;
      }

      const artifactFileMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/artifacts\/([^/]+)$/.exec(path);
      if (artifactFileMatch && method === "GET") {
        const runId = artifactFileMatch[1] ?? "";
        const run = await requireRun(runId);
        if (path.startsWith("/v1/") && (!actor || !denyUnless(run, actor, res))) {
          return;
        }
        if (!run) {
          notFound(res);
          return;
        }
        try {
          if (!(await sendArtifactBody(res, runId, decodeURIComponent(artifactFileMatch[2] ?? "")))) {
            notFound(res);
          }
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : "invalid artifact" });
        }
        return;
      }

      const tokenMatch = /^\/internal\/runs\/([^/]+)\/scm\/token$/.exec(path);
      if (tokenMatch && method === "POST") {
        const runId = tokenMatch[1] ?? "";
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as CreateGitTokenRequest;
        if (body.scope !== "clone" && body.scope !== "push") {
          send(res, 400, { error: "scope must be clone or push" });
          return;
        }
        send(res, 201, mintRunGitToken(runId, body));
        return;
      }

      const fsMatch = /^\/v1\/runs\/([^/]+)\/fs$/.exec(path);
      if (fsMatch && method === "GET") {
        const runId = fsMatch[1] ?? "";
        const run = await requireRun(runId);
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        try {
          send(
            res,
            200,
            listWorkspacePath(workspaceFor(runId), url.searchParams.get("path") ?? "", {
              content: url.searchParams.get("content") === "1",
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "fs failed";
          send(res, message.includes("not found") ? 404 : 400, { error: message });
        }
        return;
      }

      const diffMatch = /^\/v1\/runs\/([^/]+)\/diff$/.exec(path);
      if (diffMatch && method === "GET") {
        const runId = diffMatch[1] ?? "";
        const run = await requireRun(runId);
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, await getRunDiff(runId));
        return;
      }

      if (method === "POST" && path === "/v1/environments") {
        if (!actor) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        const body = (await readJson(req)) as CreateEnvironmentRequest;
        send(res, 201, createEnvironment(body, actor.orgId));
        return;
      }

      const envBuildsMatch = /^\/v1\/environments\/([^/]+)\/builds$/.exec(path);
      if (envBuildsMatch && method === "GET") {
        const env = getEnvironment(envBuildsMatch[1] ?? "");
        if (!env) {
          notFound(res);
          return;
        }
        send(res, 200, { builds: listBuildsForEnv(env.id) });
        return;
      }
      if (envBuildsMatch && method === "POST") {
        const env = getEnvironment(envBuildsMatch[1] ?? "");
        if (!env) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as CreateBuildRequest;
        const repoUrls =
          Array.isArray(body.repoUrls) && body.repoUrls.length > 0 ? body.repoUrls : (env.config.repos ?? []);
        if (repoUrls.length === 0) {
          send(res, 400, { error: "repoUrls are required" });
          return;
        }
        send(res, 201, await createEnvironmentBuild({ ...body, envId: env.id, repoUrls }));
        return;
      }

      const envMatch = /^\/v1\/environments\/([^/]+)$/.exec(path);
      if (envMatch && method === "GET") {
        const env = getEnvironment(envMatch[1] ?? "");
        if (!env) {
          notFound(res);
          return;
        }
        send(res, 200, env);
        return;
      }

      if (method === "GET" && path === "/v1/environments") {
        send(res, 200, { environments: listEnvironments() });
        return;
      }

      if (method === "POST" && path === "/v1/builds") {
        const body = (await readJson(req)) as CreateBuildRequest;
        let repoUrls = Array.isArray(body.repoUrls) ? body.repoUrls : [];
        if (repoUrls.length === 0 && body.envId) {
          repoUrls = getEnvironment(body.envId)?.config.repos ?? [];
        }
        if (repoUrls.length === 0) {
          send(res, 400, { error: "repoUrls are required" });
          return;
        }
        send(res, 201, await createEnvironmentBuild({ ...body, repoUrls }));
        return;
      }

      if (method === "GET" && path === "/v1/builds") {
        send(res, 200, { builds: listBuilds() });
        return;
      }

      const buildLogsMatch = /^\/v1\/builds\/([^/]+)\/logs$/.exec(path);
      if (buildLogsMatch && method === "GET") {
        const build = getBuild(buildLogsMatch[1] ?? "");
        if (!build) {
          notFound(res);
          return;
        }
        send(res, 200, { buildId: build.id, logs: readBuildLogs(build.id) });
        return;
      }

      const buildMatch = /^\/v1\/builds\/([^/]+)$/.exec(path);
      if (buildMatch && method === "GET") {
        const build = getBuild(buildMatch[1] ?? "");
        if (!build) {
          notFound(res);
          return;
        }
        send(res, 200, build);
        return;
      }

      if (serveWebFile(req, res)) {
        return;
      }

      notFound(res);
    } catch (error) {
      if (error instanceof QuotaError) {
        send(res, 429, { error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "internal_error";
      const status = message.includes("not found") ? 404 : 500;
      send(res, status, { error: message });
    }
  });
}
