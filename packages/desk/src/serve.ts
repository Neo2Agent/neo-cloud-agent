import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLeaseClient } from "./lease.js";
import { controlPlaneOrigin, deskPreviewListenPort } from "./ports.js";
import { spawnDeskWorker } from "./spawn.js";
import { isGitRepo, prepareDeskWorkspace, writeRunBootstrap, writeRunExpertFiles } from "./workspace.js";

export type DeskPreviewTarget = { kind: "cloud" | "desk" | "remote"; folder?: string; deskId?: string };

export type DeskPreviewOptions = {
  host?: string;
  port?: number;
  controlPlaneUrl?: string;
  folder?: string;
  lease?: boolean;
};

export type DeskPreview = {
  url: string;
  port: number;
  controlPlaneUrl: string;
  close(): Promise<void>;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function webDist(): string {
  return fileURLToPath(new URL("../../web/dist", import.meta.url));
}

export function deskBridgeInlineScript(port: number): string {
  return `(() => {
  const api = (path, opts) => fetch("/__desk" + path, Object.assign({ credentials: "same-origin" }, opts || {})).then((r) => r.json());
  window.neoDesk = {
    platform: ${JSON.stringify(process.platform)},
    apiBase: "",
    canRunLocal: true,
    getToken: () => api("/token").then((x) => x.token || ""),
    setToken: (token) => api("/token", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }),
    clearToken: () => api("/token", { method: "DELETE" }),
    pickFolder: () => api("/folder", { method: "POST" }).then((x) => x.folder || null),
    getTarget: () => api("/target"),
    setTarget: (target) => api("/target", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(target) }),
    notify: (title, body) => api("/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body }) }),
    onDeepLink: (cb) => { void cb; return () => {}; }
  };
  document.title = "Neo Desk";
  const mount = () => {
    if (document.getElementById("neo-desk-port-chip")) return;
    const chip = document.createElement("div");
    chip.id = "neo-desk-port-chip";
    chip.textContent = ${JSON.stringify(`Desk :${port}`)};
    chip.setAttribute("aria-label", "Neo Desk preview port");
    chip.style.cssText = "position:fixed;top:10px;left:10px;z-index:99999;border-radius:999px;padding:6px 10px;font:650 12px/1 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;pointer-events:none";
    document.body.appendChild(chip);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();`;
}

export function injectDeskHtml(html: string, port: number): string {
  const script = `<script>${deskBridgeInlineScript(port)}</script>`;
  const titled = html.replace(/<title>[^<]*<\/title>/i, "<title>Neo Desk</title>");
  if (/<head[^>]*>/i.test(titled)) {
    return titled.replace(/<head[^>]*>/i, (open) => `${open}${script}`);
  }
  return `${script}${titled}`;
}

function hopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const skip = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
  ]);
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || skip.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

function resolveDistFile(requestPath: string): string | null {
  const root = webDist();
  if (!existsSync(path.join(root, "index.html"))) {
    return null;
  }
  const relative = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(relative.split("?")[0] ?? relative);
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root) || !existsSync(resolved)) {
    return requestPath === "/" || !path.extname(decoded) ? path.join(root, "index.html") : null;
  }
  return resolved;
}

export async function startDeskPreview(options: DeskPreviewOptions = {}): Promise<DeskPreview> {
  const upstream = new URL(options.controlPlaneUrl || controlPlaneOrigin());
  const host = options.host || process.env.NEO_DESK_HOST || "127.0.0.1";
  const wantedPort = options.port ?? deskPreviewListenPort();
  const enableLease = options.lease !== false;
  const state = {
    userToken: "",
    deskId: "",
    deskToken: "",
    folder: options.folder || process.env.NEO_DESK_FOLDER || "",
    target: { kind: "cloud" } as DeskPreviewTarget,
    leaseLoop: false,
    closing: false,
  };

  const client = createLeaseClient(upstream.origin);
  let listenPort = wantedPort;

  const ensureRegistered = async (userToken: string): Promise<void> => {
    if (!enableLease || !userToken) {
      return;
    }
    if (state.deskId && state.deskToken && state.userToken === userToken) {
      return;
    }
    const registered = await client.register({
      name: process.env.NEO_DESK_NAME || `${os.hostname()} desk-preview`,
      hostname: os.hostname(),
      platform: process.platform,
      userToken,
    });
    state.deskId = registered.deskId;
    state.deskToken = registered.token;
    state.userToken = userToken;
    state.target = { ...state.target, deskId: registered.deskId };
    void startLeaseLoop();
  };

  const startLeaseLoop = async (): Promise<void> => {
    if (!enableLease || state.leaseLoop || !state.deskId || !state.deskToken) {
      return;
    }
    state.leaseLoop = true;
    const tick = async (): Promise<void> => {
      if (state.closing || !state.leaseLoop) {
        return;
      }
      try {
        const assignment = await client.waitAssignment({
          deskId: state.deskId,
          deskToken: state.deskToken,
          waitMs: 20_000,
        });
        if (!assignment) {
          setTimeout(() => void tick(), 250);
          return;
        }
        const folder = state.target.folder || state.folder;
        if (!folder || !isGitRepo(folder)) {
          console.warn("desk preview: assignment ignored, no authorized git folder");
          setTimeout(() => void tick(), 1000);
          return;
        }
        const workspaceDir = await prepareDeskWorkspace({ repoDir: folder, runId: assignment.runId });
        writeRunBootstrap(workspaceDir, {
          runId: assignment.runId,
          controlPlaneUrl: assignment.controlPlaneUrl,
          llmGatewayUrl: assignment.llmGatewayUrl,
          jwt: assignment.jwt,
          model: assignment.model,
        });
        writeRunExpertFiles(workspaceDir, assignment);
        const child = spawnDeskWorker({
          runId: assignment.runId,
          jwt: assignment.jwt,
          controlPlaneUrl: assignment.controlPlaneUrl,
          llmGatewayUrl: assignment.llmGatewayUrl,
          workspaceDir,
          model: assignment.model,
        });
        await client.claim({
          deskId: state.deskId,
          deskToken: state.deskToken,
          runId: assignment.runId,
          workspaceDir,
          pid: child.pid ?? undefined,
        });
        child.stdout?.on("data", (chunk) => process.stdout.write(`[desk-worker ${assignment.runId}] ${chunk}`));
        child.stderr?.on("data", (chunk) => process.stderr.write(`[desk-worker ${assignment.runId}] ${chunk}`));
      } catch (error) {
        if (!state.closing) {
          console.error("desk preview lease", error);
        }
      }
      if (!state.closing) {
        setTimeout(() => void tick(), 400);
      }
    };
    void tick();
  };

  const handleDeskApi = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const route = url.pathname.slice("/__desk".length) || "/";
    try {
      if (req.method === "GET" && route === "/health") {
        sendJson(res, 200, {
          ok: true,
          port: listenPort,
          controlPlaneUrl: upstream.origin,
          canRunLocal: true,
          deskId: state.deskId || undefined,
          folder: state.folder || undefined,
        });
        return;
      }
      if (req.method === "GET" && route === "/token") {
        sendJson(res, 200, { token: state.userToken });
        return;
      }
      if (req.method === "PUT" && route === "/token") {
        const body = JSON.parse((await readBody(req)) || "{}") as { token?: string };
        state.userToken = body.token ?? "";
        if (state.userToken) {
          await ensureRegistered(state.userToken).catch((error) => {
            console.error("desk preview register", error);
          });
        }
        sendJson(res, 200, { ok: true, deskId: state.deskId || undefined });
        return;
      }
      if (req.method === "DELETE" && route === "/token") {
        state.userToken = "";
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && route === "/target") {
        sendJson(res, 200, { ...state.target, deskId: state.deskId || state.target.deskId });
        return;
      }
      if (req.method === "PUT" && route === "/target") {
        const body = JSON.parse((await readBody(req)) || "{}") as DeskPreviewTarget;
        state.target = { ...body, deskId: body.deskId || state.deskId || undefined };
        if (body.folder) {
          state.folder = body.folder;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/folder") {
        const candidate = state.folder || process.cwd();
        if (!isGitRepo(candidate)) {
          sendJson(res, 200, { folder: null, error: "本机执行只允许 git 仓库文件夹。" });
          return;
        }
        state.folder = candidate;
        state.target = { ...state.target, kind: "desk", folder: candidate, deskId: state.deskId || undefined };
        sendJson(res, 200, { folder: candidate });
        return;
      }
      if (req.method === "POST" && route === "/notify") {
        const body = JSON.parse((await readBody(req)) || "{}") as { title?: string; body?: string };
        console.log(`[desk notify] ${body.title ?? ""} ${body.body ?? ""}`);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "bad_request" });
    }
  };

  const proxy = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const headers = hopByHop(req.headers);
    headers.host = upstream.host;
    headers["accept-encoding"] = "identity";
    const upstreamReq = http.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || 80,
        path: req.url,
        method: req.method,
        headers,
      },
      (up) => {
        const contentType = String(up.headers["content-type"] || "");
        if (contentType.includes("text/html")) {
          const chunks: Buffer[] = [];
          up.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          up.on("end", () => {
            const html = injectDeskHtml(Buffer.concat(chunks).toString("utf8"), listenPort);
            const outHeaders = { ...up.headers };
            delete outHeaders["content-length"];
            delete outHeaders["content-encoding"];
            outHeaders["content-type"] = "text/html; charset=utf-8";
            res.writeHead(up.statusCode || 200, outHeaders);
            res.end(html);
          });
          return;
        }
        res.writeHead(up.statusCode || 200, up.headers);
        up.pipe(res);
      },
    );
    upstreamReq.on("error", (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end(`desk preview proxy failed: ${error.message}`);
    });
    req.pipe(upstreamReq);
  };

  const serveLocal = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    const file = resolveDistFile(url.pathname);
    if (!file) {
      return false;
    }
    const ext = path.extname(file);
    if (ext === ".html") {
      const chunks: Buffer[] = [];
      const stream = createReadStream(file);
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => {
        const html = injectDeskHtml(Buffer.concat(chunks).toString("utf8"), listenPort);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
      });
      stream.on("error", () => {
        res.writeHead(500);
        res.end("desk preview failed to read index.html");
      });
      return true;
    }
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(file).pipe(res);
    return true;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname.startsWith("/__desk")) {
      void handleDeskApi(req, res);
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname === "/health" || url.pathname.startsWith("/internal/")) {
      proxy(req, res);
      return;
    }
    if (serveLocal(req, res)) {
      return;
    }
    proxy(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const dest = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: upstream.host },
    });
    dest.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = Object.entries(upRes.headers).flatMap(([key, value]) =>
        Array.isArray(value) ? value.map((item) => `${key}: ${item}`) : [`${key}: ${value ?? ""}`],
      );
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (upHead.length) socket.write(upHead);
      if (head.length) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    dest.on("error", () => socket.destroy());
    dest.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(wantedPort, host, () => {
      const address = server.address();
      listenPort = typeof address === "object" && address ? address.port : wantedPort;
      resolve();
    });
  });

  const url = `http://${host}:${listenPort}`;
  return {
    url,
    port: listenPort,
    controlPlaneUrl: upstream.origin,
    close: () =>
      new Promise((resolve, reject) => {
        state.closing = true;
        state.leaseLoop = false;
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const self = fileURLToPath(import.meta.url);
  return entry === self || entry === self.replace(/\.ts$/, ".js");
}

if (isMainModule()) {
  const preview = await startDeskPreview();
  console.log(`desk preview listening on ${preview.url} (web stays ${preview.controlPlaneUrl})`);
}
