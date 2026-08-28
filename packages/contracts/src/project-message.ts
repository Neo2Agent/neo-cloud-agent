export type ProjectMessageAttachment = {
  name: string;
  contentType?: string;
  assetId?: string;
};

export type ProjectMessage = {
  id: string;
  projectId: string;
  parentId: string | null;
  body: string;
  mentionUserIds: string[];
  mentionAll: boolean;
  attachments: ProjectMessageAttachment[];
  createdBy: string;
  createdEmail: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectMessageRequest = {
  body: string;
  parentId?: string | null;
  mentionUserIds?: string[];
  mentionAll?: boolean;
  attachments?: ProjectMessageAttachment[];
};

export type InboxKind = "invite_pending" | "invited" | "todo_assigned" | "mention" | "transfer";

export type InboxItem = {
  id: string;
  userId: string;
  kind: InboxKind;
  title: string;
  projectId?: string | null;
  runId?: string | null;
  todoId?: string | null;
  messageId?: string | null;
  read: boolean;
  createdAt: string;
};
