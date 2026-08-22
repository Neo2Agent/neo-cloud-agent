export type ProjectRole = "owner" | "admin" | "member";
export type InvitePolicy = "open" | "approve";
export type InviteStatus = "active" | "accepted" | "pending" | "rejected" | "revoked";

export type ProjectMember = {
  userId: string;
  email: string;
  role: ProjectRole;
  joinedAt: string;
};

export type ProjectInvite = {
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  status: InviteStatus;
  note: string;
  requestedBy?: string;
  requestedEmail?: string;
};

export type ProjectEvent = {
  id: string;
  at: string;
  actorUserId: string;
  actorEmail: string;
  kind: string;
  detail: string;
};

export type Project = {
  id: string;
  name: string;
  instruction: string;
  defaultRepoUrls: string[];
  invitePolicy: InvitePolicy;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: ProjectMember[];
  invites: ProjectInvite[];
  events: ProjectEvent[];
};

export type CreateProjectRequest = {
  name: string;
  instruction?: string;
  defaultRepoUrls?: string[];
  invitePolicy?: InvitePolicy;
};

export type UpdateProjectRequest = {
  name?: string;
  instruction?: string;
  defaultRepoUrls?: string[];
  invitePolicy?: InvitePolicy;
};

export function canManageProject(role: ProjectRole | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

export function formatProjectMemory(project: Pick<Project, "name" | "instruction">): string {
  const instruction = project.instruction.trim();
  return `# ${project.name.trim() || "项目"}\n\n${instruction || "（项目还没有写指令）"}\n`;
}

export function appendProjectInstruction(systemPrompt: string, instruction: string): string {
  const text = instruction.trim();
  if (!text) return systemPrompt;
  return `${systemPrompt}\n\n# Project instructions\nThe team wrote these rules for this project. Follow them.\n\n${text}`;
}
