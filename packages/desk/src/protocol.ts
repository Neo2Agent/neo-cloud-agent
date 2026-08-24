export function runIdFromDeepLink(url: string): string | null {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "neo:") {
      return null;
    }
    const parts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parsed.hostname === "runs" && parts[0]) {
      return parts[0];
    }
    if (parts[0] === "runs" && parts[1]) {
      return parts[1];
    }
    return null;
  } catch {
    return /^neo:\/\/runs\/([^\s/#]+)/i.exec(trimmed)?.[1] ?? null;
  }
}

export function hashForRun(runId: string): string {
  return `#/runs/${runId}`;
}
