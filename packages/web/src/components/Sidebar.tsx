import type { Run } from "@neo-cloud-agent/contracts/run";
import { preview, slotLabel, STATUS_LABELS } from "../format";
import { isActiveRunStatus } from "../turn";

export type VmSlotView = {
  id: string;
  status: string;
  runId: string | null;
};

type Props = {
  runs: Run[];
  currentRunId: string | null;
  slots: VmSlotView[];
  backend: string;
  userEmail: string;
  authed: boolean;
  authBusy: boolean;
  health: string;
  onNewChat: () => void;
  onOpenRun: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose?: () => void;
};

export function Sidebar({
  runs,
  currentRunId,
  slots,
  backend,
  userEmail,
  authed,
  authBusy,
  health,
  onNewChat,
  onOpenRun,
  onLogin,
  onLogout,
  onClose,
}: Props) {
  const items = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
          <button className="ghost sidebar-close" id="sidebar-close" type="button" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </div>
      <button className="new-chat" id="new-chat" type="button" onClick={onNewChat}>
        <span className="new-chat-plus" aria-hidden="true">
          +
        </span>
        新对话
      </button>
      <section className="vm-block">
        <p className="eyebrow">虚拟机</p>
        <div className="vm-rail" id="vm-rail" aria-label="VM 槽">
          {slots.length === 0 ? (
            <p className="hint">{backend === "none" ? "当前未启用 VM" : "VM 槽还在初始化"}</p>
          ) : (
            slots.map((slot) => {
              const occupant = items.find((run) => run.id === slot.runId || run.vmSlotId === slot.id);
              const held = slot.status === "busy" || Boolean(slot.runId);
              const current = Boolean(currentRunId && (slot.runId === currentRunId || occupant?.id === currentRunId));
              const running = Boolean(occupant && isActiveRunStatus(occupant.status));
              const title = occupant ? preview(occupant.prompt) : held ? slot.runId?.slice(0, 8) : "空闲";
              const occupancy = running ? "占用" : held ? "待命" : "空闲";
              return (
                <article
                  key={slot.id}
                  className="vm-slot"
                  data-busy={String(running)}
                  data-held={String(held && !running)}
                  data-active={String(running)}
                  data-current={String(current)}
                  data-open={occupant?.id || slot.runId || undefined}
                  onClick={() => {
                    const id = occupant?.id || slot.runId;
                    if (id) onOpenRun(id);
                  }}
                >
                  <strong>{slotLabel(slot.id)}</strong>
                  <small>
                    {occupancy} · {title}
                  </small>
                </article>
              );
            })
          )}
        </div>
      </section>
      <div className="run-list" id="run-list">
        {items.map((run) => {
          const running = isActiveRunStatus(run.status);
          return (
            <button
              key={run.id}
              className={`run-item${run.id === currentRunId ? " active" : ""}${running ? " busy" : ""}`}
              data-id={run.id}
              data-busy={running ? "true" : "false"}
              type="button"
              onClick={() => onOpenRun(run.id)}
            >
              <strong>
                {running ? <span className="pulse-dot" aria-hidden="true" /> : null}
                <span className="run-title">{preview(run.prompt)}</span>
              </strong>
              <small>
                {STATUS_LABELS[run.status] ?? run.status}
                {run.vmSlotId ? ` · ${slotLabel(run.vmSlotId)}` : ""}
              </small>
            </button>
          );
        })}
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
