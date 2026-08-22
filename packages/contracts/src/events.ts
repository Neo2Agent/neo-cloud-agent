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
  | "run.queued"
  | "run.error"
  | "run.archived"
  | "llm.usage"
  | "context.usage"
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
  | "subscription.created"
  | "subscription.delivered"
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
  | "build.used"
  | "artifact.uploaded";

export interface RunEvent {
  id: string;
  runId: string;
  createdAt: string;
  category: RunEventCategory;
  level: RunEventLevel;
  kind: RunEventKind;
  title: string;
  detail?: string;
  /** Monotonic per-run sequence assigned by the control plane. */
  seq?: number;
  /** Opaque payload for UI (token deltas, tool args, etc.). */
  data?: Record<string, unknown>;
}

export type TranscriptRole = "user" | "assistant" | "setup";

export type TranscriptTool = {
  id?: string;
  name: string;
  isError?: boolean;
  args?: unknown;
  output?: string;
  details?: Record<string, unknown>;
  status?: "running" | "done";
};

export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "tool"; tool: TranscriptTool };

/** Consecutive text or tool rows so research cards are not a footer under the reply. */
export type TranscriptGroup =
  | { type: "text"; text: string }
  | { type: "tools"; tools: TranscriptTool[] };

/** Compact catch-up view so a late subscriber does not replay every token. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  text: string;
  createdAt: string;
  streaming?: boolean;
  kind?: string;
  level?: RunEventLevel;
  tools?: TranscriptTool[];
  /** Chronological text/tool segments so tools can sit between model replies. */
  blocks?: TranscriptBlock[];
  href?: string;
  mediaType?: string;
  images?: Array<{ mediaType: string; data: string }>;
}

export interface TranscriptSnapshot {
  runId: string;
  seq: number;
  lastEventId: string | null;
  messages: TranscriptMessage[];
  /** Messages older than this page; used for scroll-up. */
  remaining?: number;
  /** Pass as `before` to fetch the previous page. */
  nextBefore?: string | null;
  /** Full compiled message count, not the page size. */
  total?: number;
}
