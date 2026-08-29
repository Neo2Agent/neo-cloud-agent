import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectTodo, TodoStatus } from "@neo-cloud-agent/contracts/project-todo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { IconPlus, IconSearch } from "../icons";
import { IslandButton } from "../island";
import { displayName, formatRel, initials } from "./helpers";

const COLUMNS: Array<{ id: TodoStatus; label: string }> = [
  { id: "claim", label: "待开始" },
  { id: "running", label: "进行中" },
  { id: "paused", label: "暂停" },
  { id: "done", label: "完成" },
];

const FILTERS: Array<{ id: "all" | TodoStatus; label: string }> = [
  { id: "all", label: "全部任务" },
  ...COLUMNS.map((item) => ({ id: item.id, label: item.label })),
];

function statusLabel(status: TodoStatus): string {
  return COLUMNS.find((item) => item.id === status)?.label ?? status;
}

function sourceLabel(source: ProjectTodo["source"]): string {
  if (source === "handoff") return "从对话流转";
  if (source === "artifact") return "产物";
  if (source === "agent") return "Agent";
  return "手动";
}

export function BoardTab({
  token,
  project,
  onStartChat,
}: {
  token: string;
  project: Project;
  onStartChat: (todoId: string, title: string) => void;
}) {
  const [todos, setTodos] = useState<ProjectTodo[]>([]);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | TodoStatus>("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await api(token, `/v1/projects/${project.id}/todos`);
    if (!response.ok) return;
    const body = await readJson<{ todos?: ProjectTodo[] }>(response);
    setTodos(body.todos ?? []);
  }, [project.id, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!title.trim()) return;
    const response = await api(token, `/v1/projects/${project.id}/todos`, {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), source: "manual" }),
    });
    const body = await readJson<ProjectTodo & { error?: string }>(response);
    if (!response.ok) {
      setError(body.error || "创建失败");
      return;
    }
    setTitle("");
    await refresh();
  };

  const move = async (todo: ProjectTodo, status: TodoStatus) => {
    if (status === "paused") {
      setPauseFor(todo.id);
      return;
    }
    const previous = todos;
    setTodos((cur) => cur.map((item) => (item.id === todo.id ? { ...item, status } : item)));
    const response = await api(token, `/v1/projects/${project.id}/todos/${todo.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setTodos(previous);
      setError((await readJson<{ error?: string }>(response)).error || "状态改失败");
    }
  };

  const confirmPause = async () => {
    if (!pauseFor || !pauseReason.trim()) return;
    const response = await api(token, `/v1/projects/${project.id}/todos/${pauseFor}/transition`, {
      method: "POST",
      body: JSON.stringify({ status: "paused", pauseReason: pauseReason.trim() }),
    });
    if (!response.ok) {
      setError((await readJson<{ error?: string }>(response)).error || "暂停失败");
      return;
    }
    setPauseFor(null);
    setPauseReason("");
    await refresh();
  };

  const open = todos.find((item) => item.id === openId) ?? null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todos.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    });
  }, [filter, query, todos]);

  const memberById = useMemo(() => new Map(project.members.map((item) => [item.userId, item])), [project.members]);

  return (
    <div className="board">
      <div className="task-toolbar">
        <div className="task-filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-chip${filter === item.id ? " on" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="task-toolbar-end">
          <label className="mine-search task-search">
            <IconSearch size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务标题" />
          </label>
          <div className="view-toggle" role="group" aria-label="任务视图">
            <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
              列表
            </button>
            <button type="button" className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
              看板
            </button>
          </div>
        </div>
      </div>
      <p className="hint task-privacy">对话默认只有你自己能看。要让同事进同一条会话，需要在云端对话里邀请。</p>
      <form
        className="board-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新任务标题" />
        <IslandButton type="default" htmlType="submit" disabled={!title.trim()}>
          新建
        </IslandButton>
      </form>

      {view === "list" ? (
        visible.length === 0 ? (
          <div className="workbench-empty">
            <strong>{todos.length === 0 ? "还没有任务" : "没有匹配的任务"}</strong>
            <p>新建一张卡，或从对话里点「流转为待办」。</p>
          </div>
        ) : (
          <ul className="task-list">
            {visible.map((item) => {
              const people = item.assigneeUserIds
                .map((id) => memberById.get(id))
                .filter((row): row is NonNullable<typeof row> => Boolean(row));
              return (
                <li key={item.id}>
                  <button type="button" className="task-row" onClick={() => setOpenId(item.id)}>
                    <span className="task-plus" aria-hidden="true">
                      <IconPlus size={16} />
                    </span>
                    <span className="task-copy">
                      <strong>{item.title}</strong>
                      <span className="task-tags">
                        <em>{sourceLabel(item.source)}</em>
                        {item.runId ? <em>已关联对话</em> : null}
                      </span>
                    </span>
                    <span className={`status-dot ${item.status}`} title={statusLabel(item.status)} />
                    <span className="avatar-stack compact">
                      {people.slice(0, 3).map((member) => (
                        <span key={member.userId} className="avatar" title={member.email}>
                          {initials(member.email)}
                        </span>
                      ))}
                    </span>
                    <span className="task-ago">{formatRel(item.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="board-columns">
          {COLUMNS.map((column) => (
            <section
              key={column.id}
              className="board-col"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const id = event.dataTransfer.getData("text/todo-id");
                const todo = todos.find((item) => item.id === id);
                if (todo) void move(todo, column.id);
              }}
            >
              <h2>
                {column.label} <em>{todos.filter((item) => item.status === column.id).length}</em>
              </h2>
              {todos
                .filter((item) => item.status === column.id)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="dash-card board-card"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/todo-id", item.id)}
                    onClick={() => setOpenId(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <em>{sourceLabel(item.source)}</em>
                  </button>
                ))}
            </section>
          ))}
        </div>
      )}

      {open ? (
        <aside className="board-drawer">
          <div className="workbench-row">
            <h2>{open.title}</h2>
            <span className={`status-pill ${open.status}`}>{statusLabel(open.status)}</span>
          </div>
          <p className="hint">{open.description || "还没有描述"}</p>
          {open.assigneeUserIds.length > 0 ? (
            <p className="hint">
              负责人{" "}
              {open.assigneeUserIds
                .map((id) => displayName(memberById.get(id)?.email ?? id))
                .join("、")}
            </p>
          ) : null}
          {open.runId ? <p className="hint">已关联对话 {open.runId.slice(0, 8)}</p> : null}
          <div className="card-actions">
            <IslandButton type="primary" onClick={() => onStartChat(open.id, open.title)}>
              在这条任务上开对话
            </IslandButton>
            <IslandButton type="default" onClick={() => setOpenId(null)}>
              关闭
            </IslandButton>
          </div>
        </aside>
      ) : null}
      {pauseFor ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPauseFor(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>暂停原因</h2>
            </header>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmPause();
              }}
            >
              <textarea value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} required />
              <footer className="modal-actions">
                <IslandButton type="default" onClick={() => setPauseFor(null)}>
                  取消
                </IslandButton>
                <IslandButton type="primary" htmlType="submit">
                  暂停
                </IslandButton>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
