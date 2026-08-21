export type EgressMode = "allow_all" | "default_plus_allowlist" | "allowlist_only";

export interface EgressPolicy {
  mode: EgressMode;
  domains?: string[];
}

export interface TerminalSpec {
  name: string;
  command: string;
}

/**
 * Durable environment config. `install` must terminate.
 * `start` / `terminals` run on every VM boot.
 */
export interface EnvironmentJson {
  snapshot?: string;
  install?: string;
  start?: string;
  terminals?: TerminalSpec[];
  repos?: string[];
  egress?: EgressPolicy;
}

export type SecretKind = "environment_variable" | "runtime" | "build";

export interface SecretRef {
  name: string;
  kind: SecretKind;
}

export interface Environment {
  id: string;
  orgId: string;
  name: string;
  /** Present when config is read from a repo file. */
  environmentJsonPath: string | null;
  config: EnvironmentJson;
  secrets: SecretRef[];
  createdAt: string;
  updatedAt: string;
}

export type BuildStatus =
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

export type BuildSource = "manual" | "scheduled" | "env_save" | "agent";

export interface Build {
  id: string;
  envId: string;
  envVersionId: string;
  status: BuildStatus;
  source: BuildSource;
  /** Draft builds never become the boot image for new runs. */
  draft: boolean;
  snapshotId: string | null;
  createdAt: string;
  completedAt: string | null;
  failureMessage: string | null;
}
