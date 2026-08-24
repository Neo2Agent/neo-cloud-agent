import type { Run } from "@neo-cloud-agent/contracts/run";

export function ChatsTab({
  runs,
  onOpenRun,
  onStartChat,
}: {
  runs: Run[];
  onOpenRun: (id: string) => void;
  onStartChat: () => void;
}) {
  return (
    <div className="workbench-stack">
      <div className="workbench-row">
        <p className="hint">只显示你自己的本机对话和你发起的云端对话。</p>
        <button type="button" className="dash-create" onClick={onStartChat}>
          在项目里开对话
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="workbench-empty">
          <strong>还没有你的对话</strong>
          <p>从概览或这里开一条。别人的会话不会出现在列表里。</p>
        </div>
      ) : (
        <ul className="chat-card-list">
          {runs.map((item) => {
            const cloud = item.executionTarget?.loop !== "desk";
            return (
              <li key={item.id}>
                <button type="button" className="dash-card" onClick={() => onOpenRun(item.id)}>
                  <span className="tile-copy">
                    <strong>{(item.prompt || "对话").replace(/\s+/g, " ").slice(0, 72)}</strong>
                    <em>
                      {cloud ? "Cloud" : "This Computer"} · {item.status} · {item.assigneeUserId ? "有房主" : ""}
                    </em>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
