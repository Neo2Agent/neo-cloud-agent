import type { TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";

type Props = {
  snapshot: TranscriptSnapshot | null;
  loading?: boolean;
  error?: string;
  onOlder?: () => void;
};

function roleLabel(role: TranscriptMessage["role"]): string {
  if (role === "user") return "用户";
  if (role === "setup") return "系统";
  return "助手";
}

export function TranscriptView({ snapshot, loading, error, onOlder }: Props) {
  const messages = snapshot?.messages ?? [];
  const remaining = snapshot?.remaining ?? 0;
  return (
    <section className="transcript-panel">
      <header className="panel-head">
        <div>
          <h3>对话内容</h3>
          <p className="hint">
            {snapshot?.total != null ? `共 ${snapshot.total} 条` : "只读 transcript"}
            {remaining > 0 ? ` · 还有 ${remaining} 条更早` : ""}
          </p>
        </div>
      </header>
      {remaining > 0 && onOlder ? (
        <button type="button" className="ghost transcript-older" disabled={loading} onClick={onOlder}>
          {loading ? "加载中…" : "加载更早的消息"}
        </button>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {loading && messages.length === 0 ? <p className="hint">正在读取对话…</p> : null}
      {!loading && messages.length === 0 && !error ? <p className="hint">这条对话还没有 transcript。</p> : null}
      <ol className="transcript-list">
        {messages.map((message) => {
          const groups = transcriptGroups(message);
          return (
            <li key={message.id} className={`transcript-msg role-${message.role}`}>
              <span className="transcript-role">{roleLabel(message.role)}</span>
              {groups.length === 0 && message.text ? <p className="transcript-text">{message.text}</p> : null}
              {groups.map((group, index) =>
                group.type === "text" ? (
                  <p key={`${message.id}-t-${index}`} className="transcript-text">
                    {group.text}
                  </p>
                ) : (
                  <ul key={`${message.id}-tools-${index}`} className="transcript-tools">
                    {group.tools.map((tool, toolIndex) => (
                      <li key={`${message.id}-${tool.name}-${toolIndex}`}>
                        <strong>{tool.name}</strong>
                        <span>{tool.isError ? "失败" : tool.status === "running" ? "进行中" : "完成"}</span>
                        {tool.output ? <pre>{tool.output.slice(0, 800)}</pre> : null}
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
