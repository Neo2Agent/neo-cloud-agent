import { BrandMark } from "@neo-cloud-agent/ui";
import { formatWhen, runTitle, slotBusy, slotLabel, statusLabel } from "../format";
import { IconChatHome, IconClose } from "../icons";
import type { AdminOverview, AdminRun } from "../types";

type Props = {
  userEmail: string;
  health: string;
  overview: AdminOverview | null;
  liveRuns: AdminRun[];
  onOpenRuns: () => void;
  onClose?: () => void;
};

export function Sidebar({ userEmail, health, overview, liveRuns, onOpenRuns, onClose }: Props) {
  const slots = overview?.capacity.slots ?? [];
  return (
    <aside className="sidebar" aria-label="管理台侧栏">
      <div className="sidebar-head">
        <div className="brand">
          <span className="mark">
            <BrandMark />
          </span>
          <div>
            <strong>Neo</strong>
            <span>管理台</span>
          </div>
        </div>
        {onClose ? (
          <button className="icon-btn sidebar-close" type="button" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        ) : null}
      </div>
      <a className="new-chat" href="/">
        <IconChatHome size={16} />
        返回对话页
      </a>
      {slots.length > 0 ? (
        <section className="vm-block">
          <p className="eyebrow">虚拟机</p>
          <div className="vm-rail" aria-label="VM 槽">
            {slots.map((slot) => {
              const occupant = liveRuns.find((run) => run.id === slot.runId);
              const held = slotBusy(slot.status) || Boolean(slot.runId);
              const running = slotBusy(slot.status);
              return (
                <article
                  key={slot.id}
                  className="vm-slot"
                  data-busy={String(running)}
                  data-held={String(held && !running)}
                >
                  <strong>{slotLabel(slot.id)}</strong>
                  <small>
                    {running ? "忙碌" : slot.mounted ? "空闲" : slot.status}
                    {occupant ? ` · ${runTitle(occupant, 18)}` : ""}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="run-list">
        <section className="run-group">
          <p className="eyebrow">进行中</p>
          {liveRuns.length === 0 ? (
            <p className="hint">{overview ? "现在没有进行中的对话" : "正在读取…"}</p>
          ) : (
            liveRuns.map((run) => (
              <div
                key={run.id}
                className="run-item busy"
                data-busy="true"
                role="button"
                tabIndex={0}
                onClick={onOpenRuns}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenRuns();
                  }
                }}
              >
                <span className="run-title">
                  <span className="pulse-dot" aria-hidden="true" />
                  {runTitle(run)}
                </span>
                <small>{statusLabel(run.status)}</small>
                <time className="run-time" dateTime={run.updatedAt}>
                  {formatWhen(run.updatedAt)}
                </time>
              </div>
            ))
          )}
        </section>
      </div>
      <footer className="sidebar-foot">
        <div className="account">
          <span>{userEmail || "已登录"}</span>
        </div>
        <span>{health}</span>
      </footer>
    </aside>
  );
}
