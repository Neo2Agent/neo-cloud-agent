import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  CreateCommitRequest,
  CreateFollowUpRequest,
  CreateGitTokenRequest,
  CreatePullRequestRequest,
  CreateRunRequest,
  RunEvent,
} from "@neo-cloud-agent/contracts";
import { listEvents, subscribe } from "../events/bus.js";
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
  mintRunGitToken,
  openRunDraftPr,
  saveRunSession,
  takeInbound,
} from "../orchestrator/orchestrator.js";
import { getConfig } from "../config.js";
import { listEnvironments } from "../env/store.js";
import { serveWebFile } from "./static.js";

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

function notFound(res: ServerResponse): void {
  send(res, 404, { error: "not_found" });
}

export function createApiServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://control-plane.local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/health") {
        const config = getConfig();
        send(res, 200, {
          ok: true,
          service: "control-plane",
          defaultModel: config.defaultModel,
          llmUpstream: config.llmUpstream,
          workerRuntime: config.workerRuntime,
          spawnLocalWorker: config.spawnLocalWorker,
        });
        return;
      }

      if (method === "POST" && path === "/v1/runs") {
        const body = (await readJson(req)) as CreateRunRequest;
        if (!body.prompt || !Array.isArray(body.repoUrls)) {
          send(res, 400, { error: "prompt and repoUrls are required" });
          return;
        }
        send(res, 201, await createRun(body));
        return;
      }

      if (method === "GET" && path === "/v1/runs") {
        send(res, 200, { runs: listRuns() });
        return;
      }

      const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(path);
      if (runMatch && method === "GET") {
        const run = getRun(runMatch[1] ?? "");
        if (!run) {
          notFound(res);
          return;
        }
        send(res, 200, run);
        return;
      }

      const followMatch = /^\/v1\/runs\/([^/]+)\/follow-ups$/.exec(path);
      if (followMatch && method === "POST") {
        const runId = followMatch[1] ?? "";
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        const body = (await readJson(req)) as CreateFollowUpRequest;
        if (!body.text) {
          send(res, 400, { error: "text is required" });
          return;
        }
        send(res, 201, enqueueFollowUp(runId, body));
        return;
      }
      if (followMatch && method === "GET") {
        send(res, 200, { followUps: listFollowUps(followMatch[1] ?? "") });
        return;
      }

      const abortMatch = /^\/v1\/runs\/([^/]+)\/abort$/.exec(path);
      if (abortMatch && method === "POST") {
        send(res, 200, abortRun(abortMatch[1] ?? ""));
        return;
      }

      const archiveMatch = /^\/v1\/runs\/([^/]+)\/archive$/.exec(path);
      if (archiveMatch && method === "POST") {
        send(res, 200, await archiveRun(archiveMatch[1] ?? ""));
        return;
      }

      const eventsMatch = /^\/v1\/runs\/([^/]+)\/events$/.exec(path);
      if (eventsMatch && method === "GET") {
        const runId = eventsMatch[1] ?? "";
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const item of listEvents(runId)) {
          res.write(`data: ${JSON.stringify(item)}\n\n`);
        }
        const unsubscribe = subscribe(runId, (item) => {
          res.write(`data: ${JSON.stringify(item)}\n\n`);
        });
        req.on("close", unsubscribe);
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

      const sessionMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/session$/.exec(path);
      if (sessionMatch && method === "GET") {
        const runId = sessionMatch[1] ?? "";
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        send(res, 200, getRunSession(runId));
        return;
      }
      if (sessionMatch && method === "POST") {
        const runId = sessionMatch[1] ?? "";
        if (!getRun(runId)) {
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
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        send(res, 200, { events: listEvents(runId) });
        return;
      }

      const commitMatch = /^\/(?:v1|internal)\/runs\/([^/]+)\/(?:scm\/)?commit$/.exec(path);
      if (commitMatch && method === "POST") {
        const runId = commitMatch[1] ?? "";
        if (!getRun(runId)) {
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
        if (!getRun(runId)) {
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
        if (!getRun(runId)) {
          notFound(res);
          return;
        }
        send(res, 200, await getRunDiff(runId));
        return;
      }

      if (method === "GET" && path === "/v1/environments") {
        send(res, 200, { environments: listEnvironments() });
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
