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

export function formatProjectMemory(
  project: Pick<Project, "name" | "instruction">,
  assets?: Array<{ path: string; size: number; createdEmail?: string; createdBy?: string }>,
): string {
  const instruction = project.instruction.trim();
  let text = `# ${project.name.trim() || "项目"}\n\n${instruction || "（项目还没有写指令）"}\n`;
  if (assets && assets.length > 0) {
    text += "\n## 项目资产\n\n对话里的文件不会自动出现在这里。\n\n";
    for (const asset of assets) {
      const who = asset.createdEmail || asset.createdBy || "";
      text += `- ${asset.path} (${asset.size} bytes${who ? `, ${who}` : ""})\n`;
    }
  }
  return text;
}

export function appendProjectInstruction(systemPrompt: string, instruction: string): string {
  const text = instruction.trim();
  if (!text) return systemPrompt;
  return `${systemPrompt}\n\n# Project instructions\nThe team wrote these rules for this project. Follow them.\n\n${text}`;
}
