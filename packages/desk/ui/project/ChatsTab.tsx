import type { Run } from "@neo-cloud-agent/contracts/run";
import { IconCloud, IconComputer } from "../icons";
import { isRemoteControlRun } from "../desk";
import { IslandButton, IslandTag } from "../island";
import { formatRel } from "./helpers";

function statusDot(status: string): string {
  if (status === "RUNNING" || status === "IDLE") return "running";
  if (status === "ERROR") return "paused";
  if (status === "ARCHIVED" || status === "FINISHED") return "done";
  return "claim";
}

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
        <p className="hint">只显示你自己的本机对话、你发起的云端对话，以及你被邀请进的协作对话。</p>
        <IslandButton type="default" onClick={onStartChat}>
          新对话
        </IslandButton>
      </div>
      {runs.length === 0 ? (
        <div className="workbench-empty">
          <strong>还没有你的对话</strong>
          <p>用下面的输入框开一条。别人的会话不会出现在这里。</p>
        </div>
      ) : (
        <ul className="task-list">
          {runs.map((item) => {
            const cloud = item.executionTarget?.loop !== "desk";
            return (
              <li key={item.id}>
                <button type="button" className="task-row" onClick={() => onOpenRun(item.id)}>
                  <span className="task-plus" aria-hidden="true">
                    {cloud ? <IconCloud size={15} /> : <IconComputer size={15} />}
                  </span>
                  <span className="task-copy">
                    <strong>{(item.prompt || "对话").replace(/\s+/g, " ").slice(0, 72)}</strong>
                    <span className="task-tags">
                      <span className="chat-place">
                        {cloud ? "cloud" : isRemoteControlRun(item) ? "remote" : "local"}
                      </span>
                      {item.assigneeUserId ? <IslandTag color="brown">有房主</IslandTag> : null}
                    </span>
                  </span>
                  <span className={`status-dot ${statusDot(item.status)}`} title={item.status} />
                  <span className="task-ago">{formatRel(item.updatedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
