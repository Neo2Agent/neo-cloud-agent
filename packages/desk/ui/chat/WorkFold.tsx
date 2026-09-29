import { formatDuration } from "@neo-cloud-agent/contracts/display";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { previewWorkTools, toolChromeKind, workGroupLabel, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { MarkdownBody } from "@neo-cloud-agent/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconChevron, IconSpinner } from "../icons";
import { ToolCard, ToolLink } from "../ToolCard";
import { useTurnDisclosure } from "./use-turn-disclosure";

function FoldGroup({
  label,
  live,
  autoOpen = false,
  children,
}: {
  label: ReactNode;
  live: boolean;
  autoOpen?: boolean;
  children: ReactNode;
}) {
  const [open, toggle] = useTurnDisclosure(live, autoOpen);
  return (
    <div className={`work-group${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span className="work-sum-label">{label}</span>
        <IconChevron size={12} className="work-chevron" />
      </button>
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">{children}</div>
      </div>
    </div>
  );
}

const WORK_LIST_STICK_PX = 24;

function ToolList({ tools, live }: { tools: TranscriptTool[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!live || !stick.current || !node) return;
    node.scrollTop = node.scrollHeight;
  }, [live, tools]);
  const { shown, hidden } = live || expanded ? { shown: tools, hidden: 0 } : previewWorkTools(tools);
  const offset = tools.length - shown.length;
  return (
    <>
      {hidden > 0 ? (
        <button type="button" className="work-more" onClick={() => setExpanded(true)}>
          还有 {hidden} 步
        </button>
      ) : null}
      <div
        ref={scroller}
        className={live ? "work-tools is-live" : "work-tools"}
        onScroll={() => {
          const node = scroller.current;
          if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < WORK_LIST_STICK_PX;
        }}
      >
        {shown.map((tool, index) => {
          const key = tool.id ?? `${tool.name}-${offset + index}`;
          return toolChromeKind(tool.name) === "link" ? (
            <ToolLink key={key} tool={tool} live={live} />
          ) : (
            <ToolCard key={key} tool={tool} live={live} />
          );
        })}
      </div>
    </>
  );
}

/** Tools and interim notes of one turn, folded like the Web transcript. */
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
  const [open, toggle] = useTurnDisclosure(live, live);
  if (turn.buckets.length === 0 && turn.notes.length === 0) return null;
  const duration = live ? "" : formatDuration(createdAt, updatedAt);
  const label = live ? "工作中" : duration ? `工作了 ${duration}` : "工作了";
  const liveFamily = live
    ? [...turn.buckets].reverse().find((bucket) => bucket.tools.some((tool) => tool.status === "running"))?.id
    : undefined;
  return (
    <div className={`work-fold${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span className="work-sum-label">
          {label}
          {live ? <IconSpinner size={12} className="spin" /> : null}
        </span>
        <IconChevron size={12} className="work-chevron" />
      </button>
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">
          {turn.notes.length > 0 ? (
            <FoldGroup label={duration ? `想了 ${duration}` : "想了"} live={live}>
              {turn.notes.map((text, index) => (
                <MarkdownBody key={index} text={text} className="work-note" />
              ))}
            </FoldGroup>
          ) : null}
          {turn.buckets.map((bucket) => (
            <FoldGroup key={bucket.id} label={workGroupLabel(bucket.id, bucket.tools)} live={live} autoOpen={liveFamily === bucket.id}>
              <ToolList tools={bucket.tools} live={live} />
            </FoldGroup>
          ))}
        </div>
      </div>
    </div>
  );
}
