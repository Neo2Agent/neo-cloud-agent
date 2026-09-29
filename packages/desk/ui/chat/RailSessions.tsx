import { RUN_MODE_SHORT_LABELS, runDisplayTitle, runMode, type Run } from "@neo-cloud-agent/contracts/run";
import { isDeskBoundRun, isRemoteControlRun } from "../desk";
import type { RailSpaceGroup } from "../../src/rail";
import { IconFolderClosed, IconFolderOpen } from "../icons";

const INBOX_PREVIEW = 8;

function preview(text: string, n = 40): string {
  return (text || "对话").replace(/\s+/g, " ").slice(0, n);
}

function runListTitle(run: Run, n = 40): string {
  return preview(runDisplayTitle(run), n);
}

export function RailSessions({
  inbox,
  spaces,
  runId,
  inboxExpanded,
  folderOpen,
  runningLocalRunIds,
  formatRel,
  onToggleInboxExpanded,
  onToggleFolder,
  onOpenRun,
}: {
  inbox: Run[];
  spaces: Array<RailSpaceGroup<Run>>;
  runId: string | null;
  inboxExpanded: boolean;
  folderOpen: Record<string, boolean>;
  /** Local runs holding a worker, so a background one is visible from any chat. */
  runningLocalRunIds?: Set<string>;
  formatRel: (iso?: string | null) => string;
  onToggleInboxExpanded: () => void;
  onToggleFolder: (key: string) => void;
  onOpenRun: (id: string) => void;
}) {
  const projects = spaces.filter((space) => space.kind === "project");
  const repos = spaces.filter((space) => space.kind !== "project");
  const shownInbox = inboxExpanded || inbox.length <= INBOX_PREVIEW ? inbox : inbox.slice(0, INBOX_PREVIEW);
  const rowProps = { runId, runningLocalRunIds, formatRel, onOpenRun };
  return (
    <div className="rail-sessions">
      <RailFolderSection title="项目" spaces={projects} folderOpen={folderOpen} onToggleFolder={onToggleFolder} {...rowProps} />
      <RailFolderSection title="仓库" spaces={repos} folderOpen={folderOpen} onToggleFolder={onToggleFolder} {...rowProps} />
      {inbox.length > 0 ? (
        <section className="rail-block" data-section="daily">
          <div className="rail-block-head">
            <span>日常</span>
            <span className="rail-count">{inbox.length}</span>
          </div>
          {shownInbox.map((run) => (
            <ChatRow
              key={run.id}
              run={run}
              active={run.id === runId}
              localRunning={runningLocalRunIds?.has(run.id)}
              formatRel={formatRel}
              onOpen={onOpenRun}
            />
          ))}
          {inbox.length > INBOX_PREVIEW ? (
            <button type="button" className="rail-more" onClick={onToggleInboxExpanded}>
              {inboxExpanded ? "收起" : `展开 ${inbox.length - INBOX_PREVIEW} 条`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function RailFolderSection({
  title,
  spaces,
  runId,
  folderOpen,
  runningLocalRunIds,
  formatRel,
  onToggleFolder,
  onOpenRun,
}: {
  title: string;
  spaces: Array<RailSpaceGroup<Run>>;
  runId: string | null;
  folderOpen: Record<string, boolean>;
  runningLocalRunIds?: Set<string>;
  formatRel: (iso?: string | null) => string;
  onToggleFolder: (key: string) => void;
  onOpenRun: (id: string) => void;
}) {
  if (spaces.length === 0) return null;
  return (
    <section className="rail-block" data-section={title}>
      <div className="rail-block-head">
        <span>{title}</span>
      </div>
      {spaces.map((space) => {
        const open = folderOpen[space.key] !== false || space.runs.some((run) => run.id === runId);
        return (
          <div key={space.key} className="rail-space">
            <button type="button" className="rail-space-folder" aria-expanded={open} onClick={() => onToggleFolder(space.key)}>
              {open ? (
                <IconFolderOpen size={16} className="rail-folder-icon" />
              ) : (
                <IconFolderClosed size={16} className="rail-folder-icon" />
              )}
              <span>{space.label}</span>
            </button>
            {open
              ? space.runs.map((run) => (
                  <ChatRow
                    key={run.id}
                    run={run}
                    active={run.id === runId}
                    nested
                    localRunning={runningLocalRunIds?.has(run.id)}
                    formatRel={formatRel}
                    onOpen={onOpenRun}
                  />
                ))
              : null}
          </div>
        );
      })}
    </section>
  );
}

function ChatRow({
  run,
  active,
  nested,
  localRunning,
  formatRel,
  onOpen,
}: {
  run: Run;
  active: boolean;
  nested?: boolean;
  localRunning?: boolean;
  formatRel: (iso?: string | null) => string;
  onOpen: (id: string) => void;
}) {
  const cloud = !isDeskBoundRun(run);
  return (
    <button
      type="button"
      className={`chat-row${nested ? " nested" : ""}${active ? " active" : ""}`}
      onClick={() => onOpen(run.id)}
    >
      <span className="chat-title">{runListTitle(run, 40)}</span>
      <span className="chat-meta">
        <i
          className={`chat-local-dot${localRunning ? " on" : ""}`}
          title={localRunning ? "正在这台电脑上改文件" : undefined}
        />
        <span className="chat-place">
          {RUN_MODE_SHORT_LABELS[cloud ? "cloud" : isRemoteControlRun(run) ? "remote" : runMode(run.executionTarget)]}
        </span>
        <span className="chat-ago">{formatRel(run.updatedAt)}</span>
      </span>
    </button>
  );
}
