import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
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

const COMPRESSIBLE = new Set([".html", ".css", ".js", ".svg", ".json", ".map"]);
const HASHED_ASSET = /^[a-zA-Z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)$/;

/** Serve the Vite production build when present; source HTML is not runnable without Vite. */
export function webRoot(): string {
  return existsSync(path.join(WEB_DIST, "index.html")) ? WEB_DIST : WEB_PACKAGE;
}

export const WEB_ROOT = WEB_PACKAGE;

export function isHashedWebAsset(file: string): boolean {
  return HASHED_ASSET.test(path.basename(file));
}

export function webCacheControl(file: string): string {
  if (isHashedWebAsset(file)) {
    return "public, max-age=31536000, immutable";
  }
  const ext = path.extname(file);
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    return "no-cache";
  }
  return "public, max-age=86400";
}

export function acceptsGzip(req: IncomingMessage): boolean {
  const raw = req.headers["accept-encoding"];
  if (!raw) {
    return false;
  }
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  return value.split(",").some((part) => part.trim().toLowerCase().startsWith("gzip"));
}

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
    "cache-control": webCacheControl(file),
  };
  const gzip = COMPRESSIBLE.has(ext) && acceptsGzip(req);
  if (gzip) {
    const body = gzipSync(readFileSync(file));
    headers["content-encoding"] = "gzip";
    headers.vary = "Accept-Encoding";
    headers["content-length"] = String(body.length);
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  }
  headers["content-length"] = String(statSync(file).size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
