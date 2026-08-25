import type { Run } from "@neo-cloud-agent/contracts/run";
import type { RailSpaceGroup } from "../../src/rail";
import { IconChevron, IconCloud, IconComputer, IconProjects } from "../icons";

const INBOX_PREVIEW = 8;

function preview(text: string, n = 40): string {
  return (text || "对话").replace(/\s+/g, " ").slice(0, n);
}

function SpaceGlyph({ kind }: { kind: RailSpaceGroup["kind"] }) {
  if (kind === "project") return <IconProjects size={13} />;
  if (kind === "folder") return <IconComputer size={13} />;
  return <IconCloud size={13} />;
}

export function RailSessions({
  inbox,
  spaces,
  runId,
  inboxOpen,
  spacesOpen,
  inboxExpanded,
  folderOpen,
  formatRel,
  onToggleInbox,
  onToggleSpaces,
  onToggleInboxExpanded,
  onToggleFolder,
  onOpenRun,
}: {
  inbox: Run[];
  spaces: Array<RailSpaceGroup<Run>>;
  runId: string | null;
  inboxOpen: boolean;
  spacesOpen: boolean;
  inboxExpanded: boolean;
  folderOpen: Record<string, boolean>;
  formatRel: (iso?: string | null) => string;
  onToggleInbox: () => void;
  onToggleSpaces: () => void;
  onToggleInboxExpanded: () => void;
  onToggleFolder: (key: string) => void;
  onOpenRun: (id: string) => void;
}) {
  const shownInbox = inboxExpanded || inbox.length <= INBOX_PREVIEW ? inbox : inbox.slice(0, INBOX_PREVIEW);
  return (
    <div className="rail-sessions">
      <section className="rail-block">
        <button type="button" className="rail-block-head" onClick={onToggleInbox}>
          <IconChevron open={inboxOpen} size={13} />
          <span>对话 ({inbox.length})</span>
        </button>
        {inboxOpen ? (
          inbox.length === 0 ? (
            <p className="pane-note">没有未选目录的对话。</p>
          ) : (
            <>
              {shownInbox.map((run) => (
                <ChatRow key={run.id} run={run} active={run.id === runId} formatRel={formatRel} onOpen={onOpenRun} />
              ))}
              {inbox.length > INBOX_PREVIEW ? (
                <button type="button" className="rail-more" onClick={onToggleInboxExpanded}>
                  {inboxExpanded ? "收起" : `展开 ${inbox.length - INBOX_PREVIEW} 条`}
                </button>
              ) : null}
            </>
          )
        ) : null}
      </section>

      <section className="rail-block">
        <button type="button" className="rail-block-head" onClick={onToggleSpaces}>
          <IconChevron open={spacesOpen} size={13} />
          <span>空间 ({spaces.length})</span>
        </button>
        {spacesOpen ? (
          spaces.length === 0 ? (
            <p className="pane-note">选择项目、本机目录或仓库后，对话会出现在这里。</p>
          ) : (
            spaces.map((space) => {
              const open = folderOpen[space.key] !== false;
              return (
                <div key={space.key} className="rail-space">
                  <button type="button" className="rail-space-folder" onClick={() => onToggleFolder(space.key)}>
                    <IconChevron open={open} size={13} />
                    <SpaceGlyph kind={space.kind} />
                    <span>{space.label}</span>
                  </button>
                  {open
                    ? space.runs.map((run) => (
                        <ChatRow
                          key={run.id}
                          run={run}
                          active={run.id === runId}
                          nested
                          formatRel={formatRel}
                          onOpen={onOpenRun}
                        />
                      ))
                    : null}
                </div>
              );
            })
          )
        ) : null}
      </section>
    </div>
  );
}

function ChatRow({
  run,
  active,
  nested,
  formatRel,
  onOpen,
}: {
  run: Run;
  active: boolean;
  nested?: boolean;
  formatRel: (iso?: string | null) => string;
  onOpen: (id: string) => void;
}) {
  const cloud = run.executionTarget?.loop !== "desk";
  return (
    <button
      type="button"
      className={`chat-row${nested ? " nested" : ""}${active ? " active" : ""}`}
      onClick={() => onOpen(run.id)}
    >
      <span className={`chat-dot${active ? " on" : ""}`} />
      <span className="chat-title">{preview(run.prompt, 40)}</span>
      <span className="chat-meta">
        {cloud ? <IconCloud size={12} /> : <IconComputer size={12} />}
        <span>{formatRel(run.updatedAt)}</span>
      </span>
    </button>
  );
}
