import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const WEB_ROOT = fileURLToPath(new URL("../../../web", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

export function resolveWebFile(requestPath: string): string | null {
  const relative = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(relative);
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const resolved = path.normalize(path.join(WEB_ROOT, decoded));
  if (!resolved.startsWith(WEB_ROOT)) {
    return null;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return null;
  }
  return resolved;
}

export function serveWebFile(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://control-plane.local");
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/internal/") || url.pathname === "/health") {
    return false;
  }
  const file = resolveWebFile(url.pathname);
  if (!file) {
    return false;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

export { WEB_ROOT };
