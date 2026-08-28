import type { Run } from "@neo-cloud-agent/contracts/run";
import { formatRunTime, preview, slotLabel, STATUS_LABELS } from "../format";
import { IconClose, IconNewChat, IconStar } from "../icons";
import { groupRuns } from "../pins";
import { isActiveRunStatus } from "../turn";

export type VmSlotView = {
  id: string;
  status: string;
  runId: string | null;
};

type Props = {
  runs: Run[];
  currentRunId: string | null;
  userEmail: string;
  authed: boolean;
  authBusy: boolean;
  health: string;
  pinnedIds?: string[];
  onNewChat: () => void;
  onOpenRun: (id: string) => void;
  onPin?: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose?: () => void;
};

export function Sidebar({
  runs,
  currentRunId,
  userEmail,
  authed,
  authBusy,
  health,
  pinnedIds = [],
  onNewChat,
  onOpenRun,
  onPin,
  onLogin,
  onLogout,
  onClose,
}: Props) {
  const items = [...runs].sort((left, right) => {
    const leftAt = left.updatedAt || left.createdAt;
    const rightAt = right.updatedAt || right.createdAt;
    return rightAt.localeCompare(leftAt) || right.createdAt.localeCompare(left.createdAt);
  });
  const grouped = groupRuns(items, pinnedIds);
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            N
          </span>
          <div>
            <strong>Neo</strong>
            <span>Cloud Agent</span>
          </div>
        </div>
        {onClose ? (
          <button className="icon-btn sidebar-close" id="sidebar-close" type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        ) : null}
      </div>
      <button className="new-chat" id="new-chat" type="button" onClick={onNewChat}>
        <IconNewChat size={16} />
        新对话
      </button>
      <div className="run-list" id="run-list">
        {(
          [
            ["置顶", grouped.pinned],
            ["进行中", grouped.active],
            ["最近", grouped.recent],
          ] as const
        ).map(([label, group]) =>
          group.length === 0 ? null : (
            <section key={label} className="run-group">
              <p className="eyebrow">{label}</p>
              {group.map((run) => {
                const running = isActiveRunStatus(run.status);
                const pinned = pinnedIds.includes(run.id);
                return (
                  <div
                    key={run.id}
                    className={`run-item${run.id === currentRunId ? " active" : ""}${running ? " busy" : ""}`}
                    data-id={run.id}
                    data-busy={running ? "true" : "false"}
                    role="button"
                    tabIndex={0}
                    aria-current={run.id === currentRunId ? "true" : undefined}
                    onClick={() => onOpenRun(run.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenRun(run.id);
                      }
                    }}
                  >
                    <span className="run-title">
                      {running ? <span className="pulse-dot" aria-hidden="true" /> : null}
                      {preview(run.prompt)}
                    </span>
                    <small>
                      {STATUS_LABELS[run.status] ?? run.status}
                      {run.executionTarget?.loop === "desk" ? " · 本机" : run.vmSlotId ? ` · ${slotLabel(run.vmSlotId)}` : ""}
                    </small>
                    <time className="run-time" dateTime={run.updatedAt || run.createdAt}>
                      {formatRunTime(run.createdAt, run.updatedAt)}
                    </time>
                    {onPin ? (
                      <button
                        type="button"
                        className={pinned ? "pin is-on" : "pin"}
                        aria-label={pinned ? "取消置顶" : "置顶"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPin(run.id);
                        }}
                      >
                        <IconStar size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ),
        )}
      </div>
      <footer className="sidebar-foot">
        <div className="account" id="account">
          <span id="account-email">{userEmail || (authBusy ? "登录中…" : "未登录")}</span>
          <button type="button" id="login" hidden={authed} onClick={onLogin}>
            登录
          </button>
          <button type="button" id="logout" hidden={!authed} onClick={onLogout}>
            退出
          </button>
        </div>
        <span id="health">{health}</span>
      </footer>
    </aside>
  );
}
