import { useState } from "react";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { formatRunTime, preview, slotLabel, STATUS_LABELS } from "../format";
import { BuddyMascot } from "@neo-cloud-agent/ui";
import { IconAutomations, IconClose, IconExperts, IconProjects, IconSkills, IconStar, IconTrash } from "../icons";
import { BuddyIcon, BuddyTargetToggle } from "@neo-cloud-agent/ui";
import { filterRuns, groupRunsByProject, isShelvedRun, splitShelvedRuns } from "../pins";
import { isActiveRunStatus } from "../turn";
import { VmSlots } from "./VmSlots";

export type VmSlotView = {
  id: string;
  status: string;
  runId: string | null;
};

type Props = {
  runs: Run[];
  currentRunId: string | null;
  slots?: VmSlotView[];
  backend?: string;
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
  onDeleteRun?: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose?: () => void;
  buddy?: boolean;
  target?: "cloud" | "desk";
  deskDisabled?: boolean;
  onTarget?: (value: "cloud" | "desk") => void;
  onOpenNav?: (id: "automations" | "experts" | "projects" | "skills") => void;
};

export function Sidebar({
  runs,
  currentRunId,
  slots = [],
  backend = "none",
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
  onDeleteRun,
  onLogin,
  onLogout,
  onClose,
  buddy = false,
  target = "cloud",
  deskDisabled = false,
  onTarget,
  onOpenNav,
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
  const { live, shelved } = splitShelvedRuns(visible);
  const grouped = groupRunsByProject(live, pinnedIds, projectNames);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const renderRun = (run: Run) => {
    const running = isActiveRunStatus(run.status);
    const pinned = pinnedIds.includes(run.id);
    const canSelect = selecting && !isShelvedRun(run.status);
    return (
      <div
        key={run.id}
        className={`run-item${canSelect ? " is-selecting" : ""}${run.id === currentRunId ? " active" : ""}${running ? " busy" : ""}`}
        data-id={run.id}
        data-busy={running ? "true" : "false"}
        role="button"
        tabIndex={0}
        aria-current={run.id === currentRunId ? "true" : undefined}
        onClick={() => (canSelect ? toggle(run.id) : onOpenRun(run.id))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (canSelect) toggle(run.id);
            else onOpenRun(run.id);
          }
        }}
      >
        {canSelect ? (
          <input
            type="checkbox"
            className="run-check"
            checked={selected.includes(run.id)}
            onChange={() => toggle(run.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label="选择对话"
          />
        ) : null}
        <div className="run-main">
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
        </div>
        {onPin && !isShelvedRun(run.status) ? (
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
        {onDeleteRun && isShelvedRun(run.status) ? (
          <button
            type="button"
            className="pin run-delete"
            aria-label="删除归档任务"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteRun(run.id);
            }}
          >
            <IconTrash size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="mark">
            <BuddyMascot size={30} compact />
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
      {buddy ? (
        <>
          {onTarget ? <BuddyTargetToggle value={target} deskDisabled={deskDisabled} wide onChange={onTarget} /> : null}
          <nav className="buddy-nav" aria-label="目录">
            {(
              [
                ["automations", "自动化", IconAutomations],
                ["experts", "专家", IconExperts],
                ["projects", "项目", IconProjects],
                ["skills", "技能", IconSkills],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => onOpenNav?.(id)}>
                <Icon size={18} />
                <span>{label}</span>
                <BuddyIcon name="chevron" size={16} />
              </button>
            ))}
          </nav>
          <div className="buddy-task-head">
            <span>任务</span>
            {onArchiveMany ? (
              <button
                type="button"
                onClick={() => {
                  setSelecting((value) => !value);
                  setSelected([]);
                }}
              >
                {selecting ? "取消" : "编辑"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <button className="new-chat" id="new-chat" type="button" onClick={onNewChat}>
        <span className="new-chat-plus" aria-hidden="true">
          +
        </span>
        {buddy ? "新建任务" : "新对话"}
      </button>
      {buddy ? null : (
        <VmSlots slots={slots} backend={backend} currentRunId={currentRunId} runs={runs} onOpenRun={onOpenRun} />
      )}
      <div className="run-tools">
        <input
          type="search"
          className="run-search"
          placeholder={buddy ? "搜索任务" : "搜索对话"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={buddy ? "搜索任务" : "搜索对话"}
        />
        {onArchiveMany && (!buddy || selecting) ? (
          <div className="run-tools-actions">
            {selecting && selected.length > 0 ? (
              <button
                type="button"
                className="toolbar-btn is-ready"
                onClick={() => {
                  onArchiveMany(selected);
                  setSelected([]);
                  setSelecting(false);
                }}
              >
                归档 {selected.length} 条
              </button>
            ) : null}
            {buddy ? null : (
              <button
                type="button"
                className={selecting ? "toolbar-btn is-on" : "toolbar-btn"}
                onClick={() => {
                  setSelecting((value) => !value);
                  setSelected([]);
                }}
              >
                {selecting ? "取消" : "批量归档"}
              </button>
            )}
          </div>
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
        {shelved.length > 0 ? (
          <details className="run-group run-archived">
            <summary className="eyebrow">已归档 · {shelved.length}</summary>
            {shelved.map(renderRun)}
          </details>
        ) : null}
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
