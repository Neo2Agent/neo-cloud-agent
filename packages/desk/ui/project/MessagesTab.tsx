import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectMessage } from "@neo-cloud-agent/contracts/project-message";
import { useCallback, useEffect, useState } from "react";
import { api, readJson } from "../api";

export function MessagesTab({
  token,
  project,
  userId,
}: {
  token: string;
  project: Project;
  userId: string;
}) {
  const [items, setItems] = useState<ProjectMessage[]>([]);
  const [body, setBody] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [mentionId, setMentionId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await api(token, `/v1/projects/${project.id}/messages`);
    if (!response.ok) return;
    const data = await readJson<{ messages?: ProjectMessage[] }>(response);
    setItems(data.messages ?? []);
  }, [project.id, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tops = items.filter((item) => !item.parentId);

  const send = async () => {
    if (!body.trim()) return;
    const mention = project.members.find((item) => item.userId === mentionId);
    const mentionUserIds = mention ? [mention.userId] : [];
    const text =
      mention && !body.includes(`@${mention.email}`) && !body.includes(`@${mention.email.split("@")[0]}`)
        ? `@${mention.email.split("@")[0]} ${body}`
        : body;
    const response = await api(token, `/v1/projects/${project.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: text, parentId: replyId, mentionUserIds }),
    });
    const data = await readJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(data.error || "发送失败");
      return;
    }
    setBody("");
    setReplyId(null);
    setMentionId("");
    await refresh();
  };

  return (
    <div className="workbench-stack">
      <h2>留言</h2>
      {tops.map((item) => (
        <article key={item.id} className="settings-card">
          <strong>{item.createdEmail}</strong>
          <p>{item.body}</p>
          <button type="button" className="ghost" onClick={() => setReplyId(item.id)}>
            回复
          </button>
          {item.createdBy === userId ? (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void api(token, `/v1/projects/${project.id}/messages/${item.id}`, { method: "DELETE" }).then(() => refresh());
              }}
            >
              删除
            </button>
          ) : null}
          <ul className="event-list">
            {items
              .filter((row) => row.parentId === item.id)
              .map((row) => (
                <li key={row.id}>
                  <strong>{row.createdEmail}</strong>
                  <span>{row.body}</span>
                </li>
              ))}
          </ul>
        </article>
      ))}
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="hint">{replyId ? "回复一条留言" : "发一条项目留言"}</p>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} />
        <label>
          <span>@ 成员</span>
          <select value={mentionId} onChange={(event) => setMentionId(event.target.value)}>
            <option value="">不点名</option>
            {project.members
              .filter((item) => item.userId !== userId)
              .map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.email}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="dash-create" disabled={!body.trim()}>
          发送
        </button>
        {replyId ? (
          <button type="button" className="ghost" onClick={() => setReplyId(null)}>
            取消回复
          </button>
        ) : null}
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
