export type MentionKind = "expert" | "team" | "plugin" | "asset";

export type ComposerMention = {
  kind: MentionKind;
  id: string;
  label: string;
  insert: string;
};

export function mentionTrigger(text: string): { trigger: "@"; query: string } | null {
  const idx = text.lastIndexOf("@");
  if (idx < 0) return null;
  if (idx > 0 && !/\s/.test(text[idx - 1]!)) return null;
  const after = text.slice(idx + 1);
  if (after.includes("\n") || after.includes(" ")) return null;
  return { trigger: "@", query: after };
}

export function applyMention(text: string, mention: ComposerMention): string {
  const trigger = mentionTrigger(text);
  if (!trigger) return `${text.trimEnd()} ${mention.insert} `.replace(/^\s+/, "");
  const idx = text.lastIndexOf("@");
  return `${text.slice(0, idx)}${mention.insert} `;
}

export function filterMentions(items: ComposerMention[], query: string, limit = 8): ComposerMention[] {
  const needle = query.trim().toLowerCase();
  const hits = needle
    ? items.filter((item) => item.label.toLowerCase().includes(needle) || item.insert.toLowerCase().includes(needle))
    : items;
  return hits.slice(0, limit);
}

export function mentionKindLabel(kind: MentionKind): string {
  if (kind === "asset") return "资产";
  if (kind === "plugin") return "技能";
  if (kind === "team") return "专家团";
  return "专家";
}
