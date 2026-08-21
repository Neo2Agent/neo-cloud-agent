export type RunEventCategory = "build" | "agent_setup" | "agent_run";

export type RunEventLevel = "info" | "warn" | "error";

export type RunEventKind =
  | "run.provisioning"
  | "run.install_started"
  | "run.install_succeeded"
  | "run.install_failed"
  | "run.start_started"
  | "run.start_succeeded"
  | "run.start_failed"
  | "run.terminal_started"
  | "run.terminal_exited"
  | "run.terminal_failed"
  | "run.running"
  | "run.idle"
  | "run.error"
  | "run.archived"
  | "agent.start"
  | "agent.end"
  | "message.start"
  | "message.delta"
  | "message.end"
  | "tool.start"
  | "tool.update"
  | "tool.end"
  | "followup.queued"
  | "followup.delivered"
  | "user.message"
  | "scm.clone_started"
  | "scm.clone_succeeded"
  | "scm.clone_failed"
  | "scm.branch_created"
  | "scm.branch_failed"
  | "scm.commit_succeeded"
  | "scm.commit_failed"
  | "scm.push_succeeded"
  | "scm.push_failed"
  | "scm.pr_opened"
  | "scm.pr_failed"
  | "mcp.auth_error"
  | "egress.denied"
  | "build.used";

export interface RunEvent {
  id: string;
  runId: string;
  createdAt: string;
  category: RunEventCategory;
  level: RunEventLevel;
  kind: RunEventKind;
  title: string;
  detail?: string;
  /** Opaque payload for UI (token deltas, tool args, etc.). */
  data?: Record<string, unknown>;
}
