import type { ExecutionTarget } from "./run.js";

export interface Desk {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  hostname: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  online: boolean;
}

export interface CreateDeskRequest {
  name?: string;
  hostname?: string;
  platform?: string;
}

export interface DeskAssignment {
  runId: string;
  jwt: string;
  model: string;
  prompt: string;
  repoUrls: string[];
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  target: ExecutionTarget;
  expertId?: string | null;
  expertTeamId?: string | null;
  expertMarkdown?: string;
  expertTeamMarkdown?: string;
  expertMeta?: string;
  expertAgents?: Array<{ slug: string; markdown: string }>;
}

export interface DeskLeaseResponse {
  assignment: DeskAssignment | null;
}

export interface DeskClaimRequest {
  runId: string;
  workspaceDir: string;
  pid?: number;
}

export interface HandoffRequest {
  target: ExecutionTarget;
}
