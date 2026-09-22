import { publish } from "../events/bus.js";
import { artifactKey, getObjectStore } from "../objects/store.js";

export const MAX_ARTIFACT_BYTES = 1_500_000;

export interface ArtifactUpload {
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

export type StoredArtifact = ArtifactUpload & {
  createdAt: string;
};

export function artifactUrl(runId: string, name: string): string {
  return `/v1/runs/${runId}/artifacts/${encodeURIComponent(name)}`;
}

const ARTIFACT_NAME_LIMIT = 120;

export function safeArtifactName(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("invalid artifact name");
  }
  return cleaned.slice(0, ARTIFACT_NAME_LIMIT);
}

/** Browsers guess GBK for unlabeled text. Text responses must say UTF-8. */
export function withUtf8Charset(contentType: string): string {
  const value = contentType.trim();
  if (!value || /charset\s*=/i.test(value)) return value;
  const mime = value.split(";")[0]?.trim().toLowerCase() ?? "";
  const textual =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml");
  return textual ? `${value}; charset=utf-8` : value;
}

export function guessContentType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "json") return "application/json";
  if (ext === "md") return "text/markdown; charset=utf-8";
  if (ext === "log" || ext === "txt") return "text/plain; charset=utf-8";
  if (ext === "html") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function manifestKey(runId: string): string {
  return artifactKey(runId, "uploads/manifest.json");
}

function fileKey(runId: string, name: string): string {
  return artifactKey(runId, `uploads/files/${name}`);
}

export async function listRunArtifacts(runId: string): Promise<StoredArtifact[]> {
  const raw = await getObjectStore().get(manifestKey(runId));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { artifacts?: StoredArtifact[] };
    return Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
  } catch {
    return [];
  }
}

export async function putRunArtifact(
  runId: string,
  input: {
    name: string;
    content: string;
    contentType?: string;
    encoding?: "utf8" | "base64";
  },
): Promise<StoredArtifact> {
  const name = safeArtifactName(input.name);
  const encoding = input.encoding === "base64" ? "base64" : "utf8";
  const body = encoding === "base64" ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");
  if (body.length === 0) {
    throw new Error("artifact is empty");
  }
  if (body.length > MAX_ARTIFACT_BYTES) {
    throw new Error(`artifact too large (${body.length} > ${MAX_ARTIFACT_BYTES})`);
  }
  const contentType = withUtf8Charset(input.contentType?.trim() || guessContentType(name));
  const store = getObjectStore();
  await store.put(fileKey(runId, name), body.toString("base64"), contentType);
  const item: StoredArtifact = {
    name,
    contentType,
    sizeBytes: body.length,
    createdAt: new Date().toISOString(),
    url: artifactUrl(runId, name),
  };
  const next = [...(await listRunArtifacts(runId)).filter((entry) => entry.name !== name), item];
  await store.put(manifestKey(runId), `${JSON.stringify({ artifacts: next })}\n`);
  publish({
    id: crypto.randomUUID(),
    runId,
    createdAt: item.createdAt,
    category: "agent_run",
    level: "info",
    kind: "artifact.uploaded",
    title: `已上传 ${name}`,
    data: { name, url: item.url, contentType, sizeBytes: item.sizeBytes },
  });
  return item;
}

export async function readRunArtifact(
  runId: string,
  name: string,
): Promise<{ body: Buffer; artifact: StoredArtifact } | null> {
  const safe = safeArtifactName(name);
  const artifact = (await listRunArtifacts(runId)).find((item) => item.name === safe);
  const raw = await getObjectStore().get(fileKey(runId, safe));
  if (!raw || !artifact) {
    return null;
  }
  return { body: Buffer.from(raw, "base64"), artifact };
}

/** @deprecated Prefer putRunArtifact. Kept so older callers still compile. */
export function signUpload(input: {
  runId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}): ArtifactUpload {
  const name = safeArtifactName(input.name);
  return {
    name,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    url: artifactUrl(input.runId, name),
  };
}
