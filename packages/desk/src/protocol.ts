function neoParts(url: string): { host: string; parts: string[] } | null {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "neo:") {
      return null;
    }
    const parts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { host: parsed.hostname, parts };
  } catch {
    return null;
  }
}

export function runIdFromDeepLink(url: string): string | null {
  const parsed = neoParts(url);
  if (parsed) {
    if (parsed.host === "runs" && parsed.parts[0]) return parsed.parts[0];
    if (parsed.parts[0] === "runs" && parsed.parts[1]) return parsed.parts[1];
    return null;
  }
  return /^neo:\/\/runs\/([^\s/#]+)/i.exec(url.trim())?.[1] ?? null;
}

export function inviteTokenFromDeepLink(url: string): string | null {
  const parsed = neoParts(url);
  if (parsed) {
    if (parsed.host === "invite" && parsed.parts[0]) return parsed.parts[0];
    if (parsed.parts[0] === "invite" && parsed.parts[1]) return parsed.parts[1];
    return null;
  }
  return /^neo:\/\/invite\/([^\s/#]+)/i.exec(url.trim())?.[1] ?? null;
}

export function hashForRun(runId: string): string {
  return `#/runs/${runId}`;
}

export function hashForInvite(token: string): string {
  return `#/invite/${token}`;
}

export function hashForProject(projectId: string): string {
  return `#/projects/${projectId}`;
}

export function inviteTokenFromHash(hash: string): string | null {
  return /^#\/invite\/([^\s/#]+)/.exec(hash)?.[1] ?? null;
}

export function runIdFromHash(hash: string): string | null {
  return /^#\/runs\/([^\s/#]+)/.exec(hash)?.[1] ?? null;
}

export function projectIdFromHash(hash: string): string | null {
  return /^#\/projects\/([^\s/#]+)/.exec(hash)?.[1] ?? null;
}
