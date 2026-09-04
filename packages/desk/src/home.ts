import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Same layout as Cursor's `~/.cursor`, not Electron Application Support. */
export const NEO_HOME_DIRNAME = ".neo";
export const DESK_STATE_DIRNAME = "desk";
export const SKILLS_NEO_DIRNAME = "skills-neo";
export const SKILLS_NEO_MANIFEST = ".sync-manifest.json";

export function neoHomeDir(homeDir = homedir()): string {
  return path.join(homeDir, NEO_HOME_DIRNAME);
}

export function deskStateDir(homeDir = homedir()): string {
  return path.join(neoHomeDir(homeDir), DESK_STATE_DIRNAME);
}

export function skillsNeoDir(homeDir = homedir()): string {
  return path.join(neoHomeDir(homeDir), SKILLS_NEO_DIRNAME);
}

/**
 * First launch after this change: copy `userData/neo-desk` into `~/.neo/desk`
 * so login and folder bindings survive.
 */
export function migrateLegacyDeskState(input: { legacyDir: string; homeDir?: string }): string {
  const dest = deskStateDir(input.homeDir);
  mkdirSync(dest, { recursive: true });
  if (readdirSync(dest).length > 0 || !existsSync(input.legacyDir)) {
    return dest;
  }
  cpSync(input.legacyDir, dest, { recursive: true });
  return dest;
}
