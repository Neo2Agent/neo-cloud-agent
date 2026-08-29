export type FileKind = "dir" | "md" | "json" | "ts" | "yml" | "git" | "env" | "docker" | "lock" | "file";

export function fileKind(name: string, type: "file" | "dir"): FileKind {
  if (type === "dir") {
    return "dir";
  }
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerignore") || lower === ".dockerignore") {
    return "docker";
  }
  if (lower === ".gitignore" || lower.endsWith(".gitattributes")) {
    return "git";
  }
  if (lower.startsWith(".env") || lower === ".nvmrc" || lower === ".npmrc") {
    return "env";
  }
  if (lower.endsWith(".md")) {
    return "md";
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return "json";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "ts";
  }
  if (lower.endsWith(".lock") || lower.endsWith("-lock.yaml") || lower.endsWith("-lock.yml")) {
    return "lock";
  }
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return "yml";
  }
  return "file";
}

export function nextUntitledName(entries: Array<{ name: string }>): string {
  const used = new Set(entries.map((item) => item.name.toLowerCase()));
  if (!used.has("untitled.md")) {
    return "untitled.md";
  }
  for (let i = 2; i < 100; i += 1) {
    const name = `untitled-${i}.md`;
    if (!used.has(name)) {
      return name;
    }
  }
  return `untitled-${Date.now()}.md`;
}

export function sortFsEntries<T extends { name: string; type: "file" | "dir" }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
