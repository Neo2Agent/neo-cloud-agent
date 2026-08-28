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
