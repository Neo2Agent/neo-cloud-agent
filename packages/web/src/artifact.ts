export type ArtifactPreviewKind = "html" | "image";

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
