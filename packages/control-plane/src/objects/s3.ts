import { createHash, createHmac } from "node:crypto";
import type { ObjectStore } from "./store.js";

export type S3Config = {
  bucket: string;
  region: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
};

export type S3Fetch = typeof fetch;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(now: Date): { amzDate: string; date: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, date: iso.slice(0, 8) };
}

function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function signS3Request(input: {
  method: string;
  url: URL;
  body: string;
  accessKey: string;
  secretKey: string;
  region: string;
  now?: Date;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const { amzDate: stamp, date } = amzDate(input.now ?? new Date());
  const payloadHash = sha256Hex(input.body);
  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    ...input.extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort();
  const headerLookup = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.trim()]));
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headerLookup.get(name)}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalQuery = [...input.url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonical = [
    input.method,
    encodePath(input.url.pathname) || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256Hex(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function s3ObjectUrl(config: S3Config, key: string): URL {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).replace(/\/$/, "");
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(`${endpoint}/${config.bucket}/${encodedKey}`);
}

export function createS3ObjectStore(config: S3Config, fetchImpl: S3Fetch = fetch): ObjectStore {
  if (!config.bucket || !config.accessKey || !config.secretKey) {
    throw new Error("S3 object store requires S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY");
  }

  const request = async (method: string, key: string, body = "", contentType?: string) => {
    const url = s3ObjectUrl(config, key);
    const headers = signS3Request({
      method,
      url,
      body,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region || "us-east-1",
      extraHeaders: method === "PUT" && contentType ? { "content-type": contentType } : undefined,
    });
    const response = await fetchImpl(url, { method, headers, body: method === "GET" ? undefined : body });
    return response;
  };

  return {
    kind: "s3",
    async put(key, body, contentType = "application/octet-stream") {
      const response = await request("PUT", key, body, contentType);
      if (!response.ok) {
        throw new Error(`s3 put ${response.status}`);
      }
    },
    async get(key) {
      const response = await request("GET", key);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`s3 get ${response.status}`);
      }
      return response.text();
    },
    async list(prefix) {
      const url = s3ObjectUrl(config, "");
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      const headers = signS3Request({
        method: "GET",
        url,
        body: "",
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        region: config.region || "us-east-1",
      });
      const response = await fetchImpl(url, { method: "GET", headers });
      if (!response.ok) {
        throw new Error(`s3 list ${response.status}`);
      }
      const xml = await response.text();
      return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1] ?? "").filter(Boolean);
    },
  };
}
