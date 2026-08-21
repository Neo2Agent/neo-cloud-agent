import { neoArtifact } from "./neo-artifact.js";
import { neoBrowser } from "./neo-browser.js";
import { neoDiag } from "./neo-diag.js";
import { neoGit } from "./neo-git.js";
import { neoMcp } from "./neo-mcp.js";
import { neoPr } from "./neo-pr.js";
import type { CloudExtension } from "./types.js";

export type { CloudExtension } from "./types.js";
export { neoArtifact, neoBrowser, neoDiag, neoGit, neoMcp, neoPr };

export function loadCloudExtensions(): CloudExtension[] {
  return [neoGit, neoPr, neoMcp, neoDiag, neoArtifact, neoBrowser];
}
