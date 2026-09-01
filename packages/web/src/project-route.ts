export type ProjectLocation = {
  projectId: string | null;
  assets: boolean;
  assetId: string | null;
};

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

export function projectHashHref(
  projectId?: string | null,
  opts?: { assets?: boolean; assetId?: string | null },
): string {
  if (!projectId) return "/#/projects";
  if (opts?.assetId) return `/#/projects/${projectId}/assets/${opts.assetId}`;
  if (opts?.assets) return `/#/projects/${projectId}/assets`;
  return `/#/projects/${projectId}`;
}
