import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const WEB_PACKAGE = fileURLToPath(new URL("../../../web", import.meta.url));
const WEB_DIST = path.join(WEB_PACKAGE, "dist");

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

/** Serve the Vite production build when present; source HTML is not runnable without Vite. */
export function webRoot(): string {
  return existsSync(path.join(WEB_DIST, "index.html")) ? WEB_DIST : WEB_PACKAGE;
}

export const WEB_ROOT = WEB_PACKAGE;

export function resolveWebFile(requestPath: string): string | null {
  const relative = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(relative);
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const root = webRoot();
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) {
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
  const headers: Record<string, string> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
  };
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    headers["cache-control"] = "no-store";
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
