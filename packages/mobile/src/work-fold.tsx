import { useEffect, useState, type ReactNode } from "react";
import { formatDuration } from "@neo-cloud-agent/contracts/display";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { previewWorkTools, resolveFoldOpen, workGroupLabel, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { MarkdownBody } from "@neo-cloud-agent/ui";

function useFoldOpen(live: boolean): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    if (!live) setChoice(null);
  }, [live]);
  return [resolveFoldOpen(live, choice), () => setChoice((cur) => !resolveFoldOpen(live, cur))];
}

function FoldGroup({ label, live, children }: { label: ReactNode; live: boolean; children: ReactNode }) {
  const [open, toggle] = useFoldOpen(live);
  return (
    <div className={`work-group${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span className="work-sum-label">{label}</span>
        <span className="work-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open ? <div className="work-fold-body">{children}</div> : null}
    </div>
  );
}

export function WorkFold({
  turn,
  live,
  createdAt,
  updatedAt,
  renderTools,
}: {
  turn: PartitionedTurn;
  live: boolean;
  createdAt: string;
  updatedAt?: string | null;
  renderTools: (tools: TranscriptTool[]) => ReactNode;
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
        <span className="work-chevron" aria-hidden="true">
          ›
        </span>
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
          {turn.buckets.map((bucket) => {
            const { shown, hidden } = live ? { shown: bucket.tools, hidden: 0 } : previewWorkTools(bucket.tools);
            return (
              <FoldGroup key={bucket.id} label={workGroupLabel(bucket.id, bucket.tools)} live={live}>
                {hidden > 0 ? <p className="work-more">还有 {hidden} 步</p> : null}
                {renderTools(shown)}
              </FoldGroup>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
