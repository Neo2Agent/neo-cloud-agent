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

export function previewKind(item: { name: string; contentType?: string }): ArtifactPreviewKind | null {
  const type = item.contentType ?? "";
  const name = item.name.toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return "image";
  if (type.includes("html") || name.endsWith(".html")) return "html";
  return null;
}

export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function artifactKind(item: { name: string; contentType?: string }): ArtifactKind {
  const preview = previewKind(item);
  if (preview) return preview;
  const type = item.contentType ?? "";
  const name = item.name.toLowerCase();
  if (type.includes("json") || name.endsWith(".json")) return "json";
  if (type.includes("markdown") || name.endsWith(".md")) return "markdown";
  if (type.startsWith("text/") || /\.(txt|log)$/.test(name)) return "text";
  return "file";
}

export function artifactKindLabel(item: { name: string; contentType?: string }): string {
  return KIND_LABEL[artifactKind(item)];
}
