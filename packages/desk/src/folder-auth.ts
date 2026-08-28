/**
 * Copy and predicates for authorizing a This Computer folder.
 *
 * The settings hint and the pick-folder dialog use the same sentences. The
 * host process only shows the boxes; the decisions live here so they can be
 * unit-tested without Electron.
 */

/** Shown on the settings page and in the confirm box. */
export const WORKSPACE_SCOPE_HINT = "只改这个文件夹。.neo 和云端同一套，不是另一套产品。";

export const FOLDER_CONFIRM_MESSAGE = "Agent 只会在这个文件夹里跑命令、直接改这里的文件。.neo 布局和云端相同。";

export const OVERLY_BROAD_CONFIRM_MESSAGE =
  "这个目录太宽。授权后 Agent 能改这里面所有内容。请确认要的是这一层，而不是里面的某个项目文件夹。";

export const HOME_OR_ROOT_REJECT_MESSAGE = "不能授权家目录或磁盘根。请选一个具体的项目文件夹。";

export const FOLDER_UNREADABLE_MESSAGE = "读不到这个文件夹。";

/**
 * Exact folders that are legal to pick but need a second confirm.
 * Children (for example `/Users/me/proj`) are ordinary project folders.
 */
export const OVERLY_BROAD_FOLDER_NAMES = ["tmp", "Users", "home", "opt", "usr", "var", "private"] as const;

const OVERLY_BROAD_NAMES = new Set<string>(OVERLY_BROAD_FOLDER_NAMES);

const EXACT_OVERLY_BROAD_FOLDERS = new Set(["/tmp", "/var/tmp", "/private/tmp"]);

function trimTrailingSep(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

export function isHomeOrFilesystemRoot(resolved: string, homeDir: string): boolean {
  const folder = trimTrailingSep(resolved);
  const home = trimTrailingSep(homeDir);
  if (!folder) {
    return true;
  }
  if (home && folder === home) {
    return true;
  }
  if (folder === "/" || /^[A-Za-z]:\\?$/.test(folder)) {
    return true;
  }
  return false;
}

export function isOverlyBroadFolder(resolved: string): boolean {
  const folder = trimTrailingSep(resolved);
  if (EXACT_OVERLY_BROAD_FOLDERS.has(folder)) {
    return true;
  }
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 1 && OVERLY_BROAD_NAMES.has(parts[0] ?? "")) {
    return true;
  }
  if (parts.length === 2 && /^[A-Za-z]:$/.test(parts[0] ?? "") && OVERLY_BROAD_NAMES.has(parts[1] ?? "")) {
    return true;
  }
  return false;
}
