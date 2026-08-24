import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectTodo, TodoStatus } from "@neo-cloud-agent/contracts/project-todo";
import { useCallback, useEffect, useState } from "react";
import { api, readJson } from "../api";

const COLUMNS: Array<{ id: TodoStatus; label: string }> = [
  { id: "claim", label: "待开始" },
  { id: "running", label: "进行中" },
  { id: "paused", label: "暂停" },
  { id: "done", label: "完成" },
];

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

  return (
    <div className="board">
      <form
        className="board-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新待办标题" />
        <button type="submit" className="ghost" disabled={!title.trim()}>
          建卡
        </button>
      </form>
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
                  <em>{item.source === "handoff" ? "从对话流转" : item.priority}</em>
                </button>
              ))}
          </section>
        ))}
      </div>
      {open ? (
        <aside className="board-drawer">
          <h2>{open.title}</h2>
          <p className="hint">{open.description || "还没有描述"}</p>
          {open.runId ? <p className="hint">已关联对话 {open.runId.slice(0, 8)}</p> : null}
          <button type="button" className="dash-create" onClick={() => onStartChat(open.id, open.title)}>
            在这条待办上开对话
          </button>
          <button type="button" className="ghost" onClick={() => setOpenId(null)}>
            关闭
          </button>
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
                <button type="button" className="ghost" onClick={() => setPauseFor(null)}>
                  取消
                </button>
                <button type="submit">暂停</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
