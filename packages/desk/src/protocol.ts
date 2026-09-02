export type ProjectLocation = {
  projectId: string | null;
  assets: boolean;
  assetId: string | null;
};

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

export function hashForProject(
  projectId: string,
  opts?: { assets?: boolean; assetId?: string | null },
): string {
  if (opts?.assetId) return `#/projects/${projectId}/assets/${opts.assetId}`;
  if (opts?.assets) return `#/projects/${projectId}/assets`;
  return `#/projects/${projectId}`;
}

export function hashForSkills(id?: string): string {
  return id ? `#/skills/${id}` : "#/skills";
}

export function hashForMemories(): string {
  return "#/memories";
}

export function inviteTokenFromHash(hash: string): string | null {
  return /^#\/invite\/([^\s/#]+)/.exec(hash)?.[1] ?? null;
}

export function runIdFromHash(hash: string): string | null {
  return /^#\/runs\/([^/]+)$/.exec(hash)?.[1] ?? null;
}

export function projectIdFromHash(hash: string): string | null {
  return parseProjectHash(hash).projectId;
}

export function parseProjectHash(hash: string): ProjectLocation {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash).replace(/\/+$/, "") || "/";
  const match = /^\/projects(?:\/([^/]+)(\/assets(?:\/([^/]+))?)?)?$/.exec(raw);
  if (!match) return { projectId: null, assets: false, assetId: null };
  return {
    projectId: match[1] ?? null,
    assets: Boolean(match[2]),
    assetId: match[3] ?? null,
  };
}

export function skillIdFromHash(hash: string): string | null {
  return /^#\/skills\/([^/]+)$/.exec(hash)?.[1] ?? null;
}

export function skillsFromHash(hash: string): boolean {
  return hash === "#/skills" || Boolean(skillIdFromHash(hash));
}

export function memoriesFromHash(hash: string): boolean {
  return hash === "#/memories";
}
