/**
 * Path / exec boundary shared by Desk tools workers and cloud WORKER_ROLE=tools.
 * This Computer (pi) still uses sandbox.ts inside createAgentSession; do not
 * route that local loop through neo-loop.
 */
export {
  assertExecCommand,
  assertReadablePath,
  assertWritablePath,
  ensureParentDir,
  resolveSandboxPath,
  type PathGuardError,
} from "./path-guard.js";
