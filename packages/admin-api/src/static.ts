import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const WEB_DIST = fileURLToPath(new URL("../../admin-web/dist", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function serveAdminWeb(req: IncomingMessage, res: ServerResponse): boolean {
  if ((req.method !== "GET" && req.method !== "HEAD") || !existsSync(path.join(WEB_DIST, "index.html"))) {
    return false;
  }
  const url = new URL(req.url ?? "/", "http://admin-api.local");
  if (url.pathname.startsWith("/v1/") || url.pathname === "/health") {
    return false;
  }
  const relative = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.normalize(path.join(WEB_DIST, decodeURIComponent(relative)));
  if (!resolved.startsWith(WEB_DIST) || !existsSync(resolved) || !statSync(resolved).isFile()) {
    const fallback = path.join(WEB_DIST, "index.html");
    const body = createReadStream(fallback);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    body.pipe(res);
    return true;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(resolved)] ?? "application/octet-stream",
    "cache-control": path.extname(resolved) === ".html" ? "no-cache" : "public, max-age=86400",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(resolved).pipe(res);
  return true;
}
