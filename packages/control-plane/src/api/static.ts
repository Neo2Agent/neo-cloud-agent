import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const WEB_PACKAGE = fileURLToPath(new URL("../../../web", import.meta.url));
const WEB_DIST = path.join(WEB_PACKAGE, "dist");
const ARCHITECTURE_HTML = fileURLToPath(
  new URL("../../../../docs/diagrams/architecture-complete.html", import.meta.url),
);
const SAMPLE_HTML = fileURLToPath(new URL("../../../../docs/diagrams/samplevideo.html", import.meta.url));
const SAMPLE_MP4 = fileURLToPath(new URL("../../../../docs/diagrams/samplevideo.mp4", import.meta.url));
const ARCHITECTURE_PATHS = new Set(["/architecture", "/architecture.html", "/architecture-complete.html"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".mp4": "video/mp4",
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

/** Public, no-auth architecture poster. Same file the docs repo keeps. */
export function resolveArchitectureFile(requestPath: string): string | null {
  if (!ARCHITECTURE_PATHS.has(requestPath)) {
    return null;
  }
  if (!existsSync(ARCHITECTURE_HTML) || !statSync(ARCHITECTURE_HTML).isFile()) {
    return null;
  }
  return ARCHITECTURE_HTML;
}

type ByteSpan = { start: number; end: number };

/** One `bytes=` range. Unparseable returns null so the caller sends the whole file. */
export function parseSingleByteRange(header: string, size: number): ByteSpan | "unsatisfiable" | null {
  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header.trim());
  if (!match || size < 0) {
    return match ? "unsatisfiable" : null;
  }
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") {
    return null;
  }
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) {
      return "unsatisfiable";
    }
    const length = Math.min(suffix, size);
    return { start: size - length, end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return "unsatisfiable";
  }
  const end = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isSafeInteger(end) || end < start) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

/** Public demo page and its mp4. No auth, same as the architecture poster. */
export function resolveSampleVideoFile(requestPath: string): string | null {
  const pathName = requestPath.length > 1 && requestPath.endsWith("/") ? requestPath.slice(0, -1) : requestPath;
  const file = pathName === "/architecture/samplevideo"
    ? SAMPLE_HTML
    : pathName === "/architecture/samplevideo.mp4"
      ? SAMPLE_MP4
      : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  return file;
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
  const file = resolveArchitectureFile(url.pathname) ?? resolveSampleVideoFile(url.pathname) ?? resolveWebFile(url.pathname);
  if (!file) {
    return false;
  }
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": webCacheControl(file),
  };
  if (ext === ".mp4") {
    const size = statSync(file).size;
    headers["accept-ranges"] = "bytes";
    const rawRange = req.headers.range;
    const range = typeof rawRange === "string" ? parseSingleByteRange(rawRange, size) : null;
    if (range === "unsatisfiable") {
      headers["content-range"] = `bytes */${size}`;
      res.writeHead(416, headers);
      res.end();
      return true;
    }
    if (range) {
      headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["content-length"] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return true;
    }
  }
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
