export type TodoStatus = "claim" | "running" | "paused" | "done";
export type TodoPriority = "none" | "low" | "medium" | "high" | "urgent";
export type TodoSource = "manual" | "handoff" | "artifact" | "agent";

export const TODO_TRANSITIONS: Record<TodoStatus, TodoStatus[]> = {
  claim: ["running", "paused", "done"],
  running: ["claim", "paused", "done"],
  paused: ["claim", "running", "done"],
  done: ["claim", "running", "paused"],
};

export type TodoAttachment = {
  kind: "asset" | "artifact";
  id: string;
  name: string;
};

export type ProjectTodo = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  assigneeUserIds: string[];
  startAt: string | null;
  dueAt: string | null;
  runId: string | null;
  parentTodoId: string | null;
  source: TodoSource;
  pauseReason: string | null;
  sort: number;
  labels: string[];
  attachments: TodoAttachment[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTodoComment = {
  id: string;
  todoId: string;
  projectId: string;
  body: string;
  createdBy: string;
  createdEmail: string;
  createdAt: string;
};

export type CreateTodoRequest = {
  title: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  assigneeUserIds?: string[];
  startAt?: string | null;
  dueAt?: string | null;
  runId?: string | null;
  parentTodoId?: string | null;
  source?: TodoSource;
  labels?: string[];
  attachments?: TodoAttachment[];
};

export type UpdateTodoRequest = {
  title?: string;
  description?: string;
  priority?: TodoPriority;
  assigneeUserIds?: string[];
  startAt?: string | null;
  dueAt?: string | null;
  labels?: string[];
};

export type TransitionTodoRequest = {
  status: TodoStatus;
  pauseReason?: string;
};

export function allowedTransitions(status: TodoStatus): TodoStatus[] {
  return TODO_TRANSITIONS[status];
}
