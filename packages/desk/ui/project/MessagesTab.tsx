import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectMessage } from "@neo-cloud-agent/contracts/project-message";
import { Select } from "@neo-cloud-agent/ui";
import { useCallback, useEffect, useState } from "react";
import { api, readJson } from "../api";
import { IslandButton } from "../island";
import { displayName, formatRel, initials } from "./helpers";

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
    <section className="activity-feed">
      <h2>留言</h2>
      {tops.length === 0 ? <p className="hint">还没有留言。给同事留一句，不会进某条对话。</p> : null}
      <ul className="message-thread">
        {tops.map((item) => (
          <li key={item.id} className="message-card">
            <span className="avatar">{initials(item.createdEmail)}</span>
            <div className="message-body">
              <header>
                <strong>{displayName(item.createdEmail)}</strong>
                <em>{formatRel(item.createdAt)}</em>
              </header>
              <p>{item.body}</p>
              <div className="card-actions">
                <button type="button" className="text-btn" onClick={() => setReplyId(item.id)}>
                  回复
                </button>
                {item.createdBy === userId ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      void api(token, `/v1/projects/${project.id}/messages/${item.id}`, { method: "DELETE" }).then(() => refresh());
                    }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              {items.filter((row) => row.parentId === item.id).length > 0 ? (
                <ul className="message-replies">
                  {items
                    .filter((row) => row.parentId === item.id)
                    .map((row) => (
                      <li key={row.id}>
                        <strong>{displayName(row.createdEmail)}</strong>
                        <span>{row.body}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="message-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="hint">{replyId ? "回复一条留言" : "发一条项目留言"}</p>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} placeholder="写给项目成员…" />
        <div className="message-compose-tools">
          <Select
            size="pill"
            aria-label="@ 成员"
            value={mentionId}
            onValueChange={setMentionId}
            placeholder="不点名"
            options={[
              { value: "", label: "不点名" },
              ...project.members
                .filter((item) => item.userId !== userId)
                .map((item) => ({ value: item.userId, label: `@${displayName(item.email)}` })),
            ]}
          />
          <IslandButton type="default" htmlType="submit" disabled={!body.trim()}>
            发送
          </IslandButton>
          {replyId ? (
            <button type="button" className="text-btn" onClick={() => setReplyId(null)}>
              取消回复
            </button>
          ) : null}
        </div>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
