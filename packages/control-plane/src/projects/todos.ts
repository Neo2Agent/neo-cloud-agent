import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  allowedTransitions,
  type CreateTodoRequest,
  type ProjectTodo,
  type ProjectTodoComment,
  type TodoPriority,
  type TodoStatus,
  type UpdateTodoRequest,
} from "@neo-cloud-agent/contracts/project-todo";
import { controlStateDir } from "../store/persist.js";
import { getProject, projectHasMember, recordProjectEvent } from "./store.js";

type TodoFile = { todos: ProjectTodo[]; comments: ProjectTodoComment[] };

let memo: { file: string; data: TodoFile } | null = null;

function todoFile(): string {
  return path.join(controlStateDir(), "project-todos.json");
}

function empty(): TodoFile {
  return { todos: [], comments: [] };
}

function readData(): TodoFile {
  const file = todoFile();
  if (memo?.file === file) return memo.data;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as TodoFile;
    const data = {
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    };
    memo = { file, data };
    return data;
  } catch {
    memo = { file, data: empty() };
    return memo.data;
  }
}

function writeData(data: TodoFile): void {
  const file = todoFile();
  memo = { file, data };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`, { mode: 0o600 });
}

function requireProjectMember(projectId: string, userId: string): void {
  if (!getProject(projectId) || !projectHasMember(projectId, userId)) {
    throw new Error("项目不存在");
  }
}

function asStatus(value: unknown): TodoStatus {
  return value === "running" || value === "paused" || value === "done" ? value : "claim";
}

function asPriority(value: unknown): TodoPriority {
  return value === "low" || value === "medium" || value === "high" || value === "urgent" ? value : "none";
}

export function listTodos(projectId: string, actorUserId: string): ProjectTodo[] {
  requireProjectMember(projectId, actorUserId);
  return readData()
    .todos.filter((item) => item.projectId === projectId)
    .sort((left, right) => left.sort - right.sort || left.createdAt.localeCompare(right.createdAt));
}

export function getTodo(projectId: string, todoId: string, actorUserId: string): ProjectTodo | null {
  return listTodos(projectId, actorUserId).find((item) => item.id === todoId) ?? null;
}

export function createTodo(projectId: string, input: CreateTodoRequest, actor: { userId: string; email: string }): ProjectTodo {
  requireProjectMember(projectId, actor.userId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("标题不能为空");
  if (input.parentTodoId) {
    const parent = readData().todos.find((item) => item.id === input.parentTodoId && item.projectId === projectId);
    if (!parent) throw new Error("父待办不存在");
    if (parent.parentTodoId) throw new Error("子任务只能一层");
  }
  const now = new Date().toISOString();
  const data = readData();
  const todo: ProjectTodo = {
    id: `todo_${randomUUID().slice(0, 8)}`,
    projectId,
    title,
    description: (input.description ?? "").trim(),
    status: asStatus(input.status),
    priority: asPriority(input.priority),
    assigneeUserIds: (input.assigneeUserIds ?? []).filter((item) => projectHasMember(projectId, item)),
    startAt: input.startAt ?? null,
    dueAt: input.dueAt ?? null,
    runId: input.runId ?? null,
    parentTodoId: input.parentTodoId ?? null,
    source: input.source === "handoff" || input.source === "artifact" || input.source === "agent" ? input.source : "manual",
    pauseReason: null,
    sort: data.todos.filter((item) => item.projectId === projectId).length,
    labels: input.labels ?? [],
    attachments: input.attachments ?? [],
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  writeData({ ...data, todos: [...data.todos, todo] });
  recordProjectEvent(projectId, actor, "todo_created", `创建了待办「${title}」`);
  return todo;
}

export function updateTodo(
  projectId: string,
  todoId: string,
  patch: UpdateTodoRequest,
  actor: { userId: string; email: string },
): ProjectTodo {
  requireProjectMember(projectId, actor.userId);
  const data = readData();
  const index = data.todos.findIndex((item) => item.id === todoId && item.projectId === projectId);
  const current = data.todos[index];
  if (!current) throw new Error("待办不存在");
  const next: ProjectTodo = {
    ...current,
    title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
    description: patch.description !== undefined ? patch.description : current.description,
    priority: patch.priority !== undefined ? asPriority(patch.priority) : current.priority,
    assigneeUserIds: patch.assigneeUserIds ?? current.assigneeUserIds,
    startAt: patch.startAt !== undefined ? patch.startAt : current.startAt,
    dueAt: patch.dueAt !== undefined ? patch.dueAt : current.dueAt,
    labels: patch.labels ?? current.labels,
    updatedAt: new Date().toISOString(),
  };
  data.todos[index] = next;
  writeData(data);
  return next;
}

export function transitionTodo(
  projectId: string,
  todoId: string,
  status: TodoStatus,
  actor: { userId: string; email: string },
  pauseReason?: string,
): ProjectTodo {
  requireProjectMember(projectId, actor.userId);
  const data = readData();
  const index = data.todos.findIndex((item) => item.id === todoId && item.projectId === projectId);
  const current = data.todos[index];
  if (!current) throw new Error("待办不存在");
  if (current.status !== status && !allowedTransitions(current.status).includes(status)) {
    throw new Error("不能这样改状态");
  }
  if (status === "paused" && !(pauseReason ?? "").trim()) {
    throw new Error("暂停需要写原因");
  }
  const next: ProjectTodo = {
    ...current,
    status,
    pauseReason: status === "paused" ? (pauseReason ?? "").trim() : null,
    updatedAt: new Date().toISOString(),
  };
  data.todos[index] = next;
  writeData(data);
  recordProjectEvent(projectId, actor, "todo_status", `把「${current.title}」标为 ${status}`);
  return next;
}

export function bindTodoRun(todoId: string, runId: string, projectId: string): ProjectTodo {
  const data = readData();
  const index = data.todos.findIndex((item) => item.id === todoId && item.projectId === projectId);
  const current = data.todos[index];
  if (!current) throw new Error("待办不存在");
  const next = { ...current, runId, updatedAt: new Date().toISOString() };
  data.todos[index] = next;
  writeData(data);
  return next;
}

export function attachTodoFiles(todoId: string, projectId: string, attachments: ProjectTodo["attachments"]): ProjectTodo {
  const data = readData();
  const index = data.todos.findIndex((item) => item.id === todoId && item.projectId === projectId);
  const current = data.todos[index];
  if (!current) throw new Error("待办不存在");
  const next = { ...current, attachments: [...current.attachments, ...attachments], updatedAt: new Date().toISOString() };
  data.todos[index] = next;
  writeData(data);
  return next;
}

export function listTodoComments(projectId: string, todoId: string, actorUserId: string): ProjectTodoComment[] {
  if (!getTodo(projectId, todoId, actorUserId)) throw new Error("待办不存在");
  return readData().comments.filter((item) => item.todoId === todoId);
}

export function addTodoComment(
  projectId: string,
  todoId: string,
  body: string,
  actor: { userId: string; email: string },
): ProjectTodoComment {
  if (!getTodo(projectId, todoId, actor.userId)) throw new Error("待办不存在");
  const text = body.trim();
  if (!text) throw new Error("评论不能为空");
  const comment: ProjectTodoComment = {
    id: `tdc_${randomUUID().slice(0, 8)}`,
    todoId,
    projectId,
    body: text,
    createdBy: actor.userId,
    createdEmail: actor.email,
    createdAt: new Date().toISOString(),
  };
  const data = readData();
  writeData({ ...data, comments: [...data.comments, comment] });
  return comment;
}
