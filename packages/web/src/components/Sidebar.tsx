import { useState } from "react";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { formatRunTime, preview, slotLabel, STATUS_LABELS } from "../format";
import { filterRuns, groupRunsByProject } from "../pins";
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
  pinnedIds?: string[];
  projectNames?: Record<string, string>;
  onNewChat: () => void;
  onOpenRun: (id: string) => void;
  onPin?: (id: string) => void;
  onArchiveMany?: (ids: string[]) => void;
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
  pinnedIds = [],
  projectNames = {},
  onNewChat,
  onOpenRun,
  onPin,
  onArchiveMany,
  onLogin,
  onLogout,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const items = [...runs].sort((left, right) => {
    const leftAt = left.updatedAt || left.createdAt;
    const rightAt = right.updatedAt || right.createdAt;
    return rightAt.localeCompare(leftAt) || right.createdAt.localeCompare(left.createdAt);
  });
  const visible = filterRuns(items, query);
  const grouped = groupRunsByProject(visible, pinnedIds, projectNames);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const renderRun = (run: Run) => {
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
        onClick={() => (selecting ? toggle(run.id) : onOpenRun(run.id))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selecting) toggle(run.id);
            else onOpenRun(run.id);
          }
        }}
      >
        {selecting ? (
          <input
            type="checkbox"
            className="run-check"
            checked={selected.includes(run.id)}
            onChange={() => toggle(run.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label="选择对话"
          />
        ) : null}
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
            {pinned ? "★" : "☆"}
          </button>
        ) : null}
      </div>
    );
  };

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
      <div className="run-tools">
        <input
          type="search"
          className="run-search"
          placeholder="搜索对话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索对话"
        />
        {onArchiveMany ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (selecting && selected.length > 0) {
                onArchiveMany(selected);
                setSelected([]);
                setSelecting(false);
                return;
              }
              setSelecting((value) => !value);
              setSelected([]);
            }}
          >
            {selecting ? (selected.length ? `归档 ${selected.length} 条` : "取消多选") : "批量归档"}
          </button>
        ) : null}
      </div>
      <div className="run-list" id="run-list">
        {grouped.pinned.length > 0 ? (
          <section className="run-group">
            <p className="eyebrow">置顶</p>
            {grouped.pinned.map(renderRun)}
          </section>
        ) : null}
        {grouped.sections.map((section) =>
          section.active.length + section.recent.length === 0 ? null : (
            <section key={section.key} className="run-group">
              <p className="eyebrow">{section.label}</p>
              {section.active.map(renderRun)}
              {section.recent.map(renderRun)}
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
