import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  CreateBuildRequest,
  CreateCommitRequest,
  CreateEnvironmentRequest,
  CreateFollowUpRequest,
  CreateGitTokenRequest,
  CreatePullRequestRequest,
  CreateRunRequest,
  RunEvent,
} from "@neo-cloud-agent/contracts";
import { evaluateEgress } from "@neo-cloud-agent/contracts";
import { listEvents } from "../events/bus.js";
import { attachEventStream } from "../events/stream.js";
import { buildTranscriptSnapshot } from "../events/transcript.js";
import {
  abortRun,
  archiveRun,
  commitRun,
  createRun,
  enqueueFollowUp,
  getBootstrap,
  getRun,
  getRunDiff,
  getRunSession,
  ingestEvents,
  listFollowUps,
  listRuns,
  loadRunIntoMemory,
  mintRunGitToken,
  openRunDraftPr,
  recoverLiveWorkers,
  restoreArchivedRun,
  saveRunSession,
  startWorkerLeaseWatch,
  takeInbound,
} from "../orchestrator/orchestrator.js";
import { AccountError, loginAccount, logoutSession, registerAccount, sessionCookieHeader, clearSessionCookieHeader } from "../accounts/accounts.js";
import { getConfig } from "../config.js";
import { getObjectStore } from "../objects/store.js";
import { startPlatform, platformInfo } from "../platform.js";
import {
  accessRequired,
  accountsRequired,
  cookieHeader,
  matchApiToken,
  resolveActor,
  resolveApiToken,
  verifyWorkerJwt,
} from "../security/auth.js";
import { actorCanAccessRun, type Actor } from "../security/actor.js";
import { createEnvironmentBuild, getBuild, listBuilds, listBuildsForEnv, readBuildLogs } from "../env/builds.js";
import { createEnvironment, getEnvironment, listEnvironments } from "../env/store.js";
import { readyWarmCount } from "../env/warm-pool.js";
import { serveWebFile } from "./static.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Last-Event-ID, Content-Type, Authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
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
        send(res, 200, {
          ok: true,
          service: "control-plane",
          defaultModel: config.defaultModel,
          llmUpstream: config.llmUpstream,
          workerRuntime: config.workerRuntime,
          spawnLocalWorker: config.spawnLocalWorker,
          objectStore: getObjectStore().kind,
          authRequired: accessRequired(),
          accountsEnabled: true,
          accountsRequired: accountsRequired(),
          warmPoolReady: readyWarmCount(),
          builds: listBuilds().filter((item) => item.status === "SUCCEEDED" && !item.draft).length,
          ...platformInfo(),
        });
        return;
      }

      if (method === "POST" && path === "/v1/auth/register") {
        const body = (await readJson(req)) as { email?: string; password?: string };
        try {
          const created = await registerAccount(body);
          sendAuthSession(res, 201, created);
        } catch (error) {
          sendAccountError(res, error);
        }
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
          send(res, 200, { ok: true, authRequired: false });
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
        const actor = await resolveActor(req, url);
        if (!actor) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        if (method === "GET" && path === "/v1/me") {
          send(res, 200, { user: actor.kind === "user" ? { id: actor.userId, email: actor.email, orgId: actor.orgId } : null, actor: actor.kind });
          return;
        }
        if (method === "POST" && path === "/v1/runs") {
          const body = (await readJson(req)) as CreateRunRequest;
          if (!body.prompt || !Array.isArray(body.repoUrls)) {
            send(res, 400, { error: "prompt and repoUrls are required" });
            return;
          }
          send(res, 201, await createRun(body, { userId: actor.userId, orgId: actor.orgId }));
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
        send(res, 201, await enqueueFollowUp(runId, body));
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

      const abortMatch = /^\/v1\/runs\/([^/]+)\/abort$/.exec(path);
      if (abortMatch && method === "POST") {
        const run = await requireRun(abortMatch[1] ?? "");
        if (!actor || !denyUnless(run, actor, res)) {
          return;
        }
        send(res, 200, abortRun(abortMatch[1] ?? ""));
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
        send(res, 200, getBootstrap(bootstrapMatch[1] ?? ""));
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
        const events = listEvents(runId);
        send(res, 200, { events, snapshot: buildTranscriptSnapshot(runId, events) });
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
      const message = error instanceof Error ? error.message : "internal_error";
      const status = message.includes("not found") ? 404 : 500;
      send(res, status, { error: message });
    }
  });
}
