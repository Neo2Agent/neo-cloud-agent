export type ArtifactPreviewKind = "html" | "image";
export type ArtifactKind = ArtifactPreviewKind | "json" | "markdown" | "text" | "file";

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: "HTML",
  image: "图片",
  json: "JSON",
  markdown: "Markdown",
  text: "文本",
  file: "文件",
};

export function previewKind(item: { name?: string; path?: string; contentType?: string }): ArtifactPreviewKind | null {
  const type = item.contentType ?? "";
  const filename = (item.name ?? item.path ?? "").toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(filename)) return "image";
  if (type.includes("html") || filename.endsWith(".html")) return "html";
  return null;
}

export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function artifactKind(item: { name?: string; path?: string; contentType?: string }): ArtifactKind {
  const preview = previewKind(item);
  if (preview) return preview;
  const type = item.contentType ?? "";
  const filename = (item.name ?? item.path ?? "").toLowerCase();
  if (type.includes("json") || filename.endsWith(".json")) return "json";
  if (type.includes("markdown") || filename.endsWith(".md")) return "markdown";
  if (type.startsWith("text/") || /\.(txt|log)$/.test(filename)) return "text";
  return "file";
}

export function artifactKindLabel(item: { name?: string; path?: string; contentType?: string }): string {
  return KIND_LABEL[artifactKind(item)];
}

export function artifactUploadName(message: { name?: string; href?: string; text?: string }): string {
  if (message.name?.trim()) return message.name.trim();
  const href = (message.href ?? "").split("?")[0] ?? "";
  const fromHref = decodeURIComponent(href.split("/").pop() ?? "");
  if (fromHref && fromHref !== "artifacts") return fromHref;
  const match = /已上传\s+(.+)$/.exec(message.text ?? "");
  return match?.[1]?.trim() ?? "";
}

/** Object URLs inherit the blob type. HTML without charset renders as Latin-1. */
export function blobForPreview(blob: Blob, item: { name?: string; path?: string; contentType?: string }): Blob {
  if (previewKind(item) !== "html") return blob;
  if (/charset=/i.test(blob.type)) return blob;
  return new Blob([blob], { type: "text/html; charset=utf-8" });
}
