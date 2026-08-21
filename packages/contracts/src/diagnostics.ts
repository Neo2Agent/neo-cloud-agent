import type { EgressPolicy } from "./environment.js";
import type { RunEvent } from "./events.js";
import type { RunStatus, SetupStatus } from "./run.js";

export interface RunDiagnosticsSummary {
  id: string;
  status: RunStatus;
  setupStatus: SetupStatus;
  envId: string | null;
  envVersionId: string | null;
  buildId: string | null;
  branchName: string | null;
  baseBranch: string | null;
  model: string;
  errorMessage: string | null;
  repoUrls: string[];
}

export interface RunDiagnosticsEnvironment {
  id: string;
  name: string;
  environmentJsonPath: string | null;
}

export interface RunDiagnosticsBuild {
  id: string;
  status: string;
  draft: boolean;
  fingerprint: string;
  envVersionId: string;
}

export interface RunDiagnosticsLog {
  name: string;
  content: string;
}

/** Worker-facing snapshot for neo-diag (setup, egress, environment version). */
export interface RunDiagnostics {
  run: RunDiagnosticsSummary;
  environment: RunDiagnosticsEnvironment | null;
  build: RunDiagnosticsBuild | null;
  egress: EgressPolicy;
  events: RunEvent[];
  logs: RunDiagnosticsLog[];
}
