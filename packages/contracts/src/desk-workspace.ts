/**
 * Desk workspace identity. Absolute paths never leave the machine, so remote
 * clients match on a repo key plus the folder short name instead.
 */

/** Last path segment of a local folder, for both POSIX and Windows paths. */
export function deskWorkspaceShortName(folder: string): string {
  const clean = folder.trim().replace(/[\\/]+$/, "");
  if (!clean) {
    return "";
  }
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? clean;
}

/**
 * Stable key for "which repo is this folder". A remote gives every machine the
 * same key so a dispatch can be matched; a plain folder falls back to its name.
 */
export function deskRepoKey(input: { remoteUrl?: string | null; folder?: string }): string {
  const remote = normalizeRemote(input.remoteUrl ?? "");
  if (remote) {
    return remote;
  }
  const name = deskWorkspaceShortName(input.folder ?? "");
  return name ? `local:${name.toLowerCase()}` : "";
}

function normalizeRemote(raw: string): string {
  let value = raw.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/\.git$/i, "").replace(/\/+$/, "");
  const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(value);
  if (scp) {
    return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+/, "").toLowerCase()}`;
  }
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/^\/+/, "").toLowerCase();
    return path ? `${url.hostname.toLowerCase()}/${path}` : "";
  } catch {
    return value.toLowerCase();
  }
}
