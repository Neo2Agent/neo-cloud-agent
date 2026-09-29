import { formatDuration } from "@neo-cloud-agent/contracts/display";
import { toolChromeKind, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { MarkdownBody } from "@neo-cloud-agent/ui";
import { useLayoutEffect, useRef } from "react";
import { IconChevron, IconSpinner } from "../icons";
import { ToolCard, ToolLink } from "../ToolCard";
import { useTurnDisclosure } from "./use-turn-disclosure";

const WORK_LIST_STICK_PX = 24;

/** Tools and interim notes of one turn, in the order the model produced them. */
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
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!live || !stick.current || !node) return;
    node.scrollTop = node.scrollHeight;
  }, [live, turn.steps]);
  if (turn.steps.length === 0) return null;
  const duration = live ? "" : formatDuration(createdAt, updatedAt);
  const label = live ? "工作中" : duration ? `工作了 ${duration}` : "工作了";
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
          <div
            ref={scroller}
            className="work-tools"
            onScroll={() => {
              const node = scroller.current;
              if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < WORK_LIST_STICK_PX;
            }}
          >
            {turn.steps.map((step, index) => {
              if (step.type === "note") {
                return <MarkdownBody key={`note-${index}`} text={step.text} className="work-note" />;
              }
              const key = step.tool.id ?? `${step.tool.name}-${index}`;
              return toolChromeKind(step.tool.name) === "link" ? (
                <ToolLink key={key} tool={step.tool} live={live} />
              ) : (
                <ToolCard key={key} tool={step.tool} live={live} />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
