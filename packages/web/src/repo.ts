/** Absolute folder / file:// refs belong on Desk, not the cloud VM. */
export function isLocalFolderRef(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text) || /^git@/i.test(text) || text.endsWith(".git")) return false;
  return text.startsWith("/") || text.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(text);
}

export function cloudSafeRepoUrls(urls: string[]): string[] {
  return urls.map((item) => item.trim()).filter((item) => item && !isLocalFolderRef(item));
}

/** Accept owner/repo, github.com/owner/repo, or a full git URL. */
export function normalizeRepoUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || /^git@/i.test(text)) return text;
  const hostPath = text.replace(/^github\.com\//i, "");
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(hostPath)) {
    const path = hostPath.endsWith(".git") ? hostPath : `${hostPath}.git`;
    return `https://github.com/${path}`;
  }
  return text;
}

export function repoShortLabel(value: string): string {
  const text = value.trim();
  if (!text) return "";
  const cleaned = text.replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = cleaned.split(/[:/]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return cleaned;
}

export function splitRepoLabel(fullName: string): { owner: string; name: string } {
  const text = fullName.trim();
  const slash = text.lastIndexOf("/");
  if (slash <= 0 || slash === text.length - 1) return { owner: "", name: text };
  return { owner: text.slice(0, slash), name: text.slice(slash + 1) };
}
