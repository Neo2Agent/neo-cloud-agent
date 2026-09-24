import { formatDuration } from "@neo-cloud-agent/contracts/display";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { previewWorkTools, resolveFoldOpen, workGroupLabel, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { MarkdownBody } from "@neo-cloud-agent/ui";
import { useEffect, useState, type ReactNode } from "react";
import { ToolCard } from "../ToolCard";

/** Open while the turn is live, closed once it settles, unless the user clicked. */
function useFoldOpen(live: boolean): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    if (!live) setChoice(null);
  }, [live]);
  const open = resolveFoldOpen(live, choice);
  return [open, () => setChoice(!open)];
}

function FoldGroup({ label, live, children }: { label: ReactNode; live: boolean; children: ReactNode }) {
  const [open, toggle] = useFoldOpen(live);
  return (
    <div className={`work-group${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span className="work-sum-label">{label}</span>
        <span className="work-chevron" aria-hidden="true">›</span>
      </button>
      {open ? <div className="work-fold-body">{children}</div> : null}
    </div>
  );
}

function ToolList({ tools, live }: { tools: TranscriptTool[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = live || expanded ? { shown: tools, hidden: 0 } : previewWorkTools(tools);
  const offset = tools.length - shown.length;
  return (
    <div className="tool-stack">
      {hidden > 0 ? (
        <button type="button" className="work-more" onClick={() => setExpanded(true)}>
          还有 {hidden} 步
        </button>
      ) : null}
      {shown.map((tool, index) => (
        <ToolCard key={tool.id ?? `${tool.name}-${offset + index}`} tool={tool} />
      ))}
    </div>
  );
}

/** Tools and interim notes of one turn, folded under "工作中" / "工作了 12s" like Web. */
export function WorkFold({
  turn,
  live,
  createdAt,
  updatedAt,
}: {
  turn: PartitionedTurn;
  live: boolean;
  createdAt: string;
  updatedAt?: string | null;
}) {
  const [open, toggle] = useFoldOpen(live);
  if (turn.buckets.length === 0 && turn.notes.length === 0) return null;
  const duration = live ? "" : formatDuration(createdAt, updatedAt);
  return (
    <div className={`work-fold${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span className="work-sum-label">
          {live ? "工作中" : duration ? `工作了 ${duration}` : "工作了"}
          {live ? <span className="work-spinner" aria-hidden="true" /> : null}
        </span>
        <span className="work-chevron" aria-hidden="true">›</span>
      </button>
      {open ? (
        <div className="work-fold-body">
          {turn.notes.length > 0 ? (
            <FoldGroup label={duration ? `想了 ${duration}` : "想了"} live={live}>
              {turn.notes.map((text, index) => (
                <MarkdownBody key={index} text={text} className="work-note" />
              ))}
            </FoldGroup>
          ) : null}
          {turn.buckets.map((bucket) => (
            <FoldGroup key={bucket.id} label={workGroupLabel(bucket.id, bucket.tools)} live={live}>
              <ToolList tools={bucket.tools} live={live} />
            </FoldGroup>
          ))}
        </div>
      ) : null}
    </div>
  );
}
