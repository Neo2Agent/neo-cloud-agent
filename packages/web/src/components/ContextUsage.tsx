import { useState } from "react";
import type { ContextUsageBucketId, ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { formatTokenCount, layoutContextBar } from "@neo-cloud-agent/contracts/context-usage";

const COLORS: Record<ContextUsageBucketId, string> = {
  system: "#9ca3af",
  rules: "#047857",
  memory: "#a16207",
  skills: "#0891b2",
  tools: "#8b5cf6",
  cloudTools: "#9d174d",
  mcp: "#2563eb",
  subagents: "#7c3aed",
  summarized: "#b91c1c",
  conversation: "#f97316",
};

type Props = {
  usage: ContextUsageSnapshot;
  open: boolean;
  onToggle: () => void;
};

function bucketColor(id: string): string {
  return COLORS[id as ContextUsageBucketId] ?? "#9ca3af";
}

/** Same 6px flex bar as before; widths come from the shared layout so a 0.3% fill stays a sliver. */
function UsageBar({ usage }: { usage: ContextUsageSnapshot }) {
  const layout = layoutContextBar({
    width: 1000,
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    buckets: usage.buckets,
  });
  return (
    <div className="context-usage-bar" aria-hidden="true">
      {layout.slices.map((slice) => (
        <i
          key={slice.id}
          title={`${slice.label}  ${formatTokenCount(slice.tokens)}`}
          style={{
            width: `${(slice.width / 1000) * 100}%`,
            background: bucketColor(slice.id),
          }}
        />
      ))}
    </div>
  );
}

export function ContextUsageControl({ usage, open, onToggle }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const percentLabel = usage.percent == null ? "用量" : `${Math.max(0, Math.round(usage.percent))}%`;
  const total = usage.contextWindow
    ? `~${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} Tokens`
    : `~${formatTokenCount(usage.tokens)} Tokens · 窗口未知`;

  return (
    <div className="context-usage">
      <button
        type="button"
        id="context-usage-toggle"
        className="context-usage-chip"
        aria-expanded={open}
        aria-controls="context-usage-pop"
        onClick={onToggle}
      >
        {percentLabel}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="context-usage-backdrop"
            aria-label="关闭上下文用量"
            onClick={onToggle}
          />
          <div className="context-usage-pop" id="context-usage-pop" role="dialog" aria-label="上下文用量">
            <div className="context-usage-head">
              <strong>上下文用量</strong>
              <button type="button" className="ghost" aria-label="关闭" onClick={onToggle}>
                ×
              </button>
            </div>
            <p className="context-usage-status">
              <span>{usage.percent == null ? "未登记该模型的窗口" : `${Math.max(0, Math.round(usage.percent))}% 已用`}</span>
              <span>{total}</span>
            </p>
            <UsageBar usage={usage} />
            <ul className="context-usage-list">
              {usage.buckets.flatMap((bucket) => {
                const kids = bucket.children ?? [];
                const isOpen = Boolean(expanded[bucket.id]);
                const parent = (
                  <li
                    key={bucket.id}
                    aria-expanded={kids.length ? isOpen : undefined}
                    onClick={
                      kids.length
                        ? () => setExpanded((current) => ({ ...current, [bucket.id]: !current[bucket.id] }))
                        : undefined
                    }
                  >
                    <span>
                      <i style={{ background: bucketColor(bucket.id) }} />
                      {bucket.label}
                    </span>
                    <span>{formatTokenCount(bucket.tokens)}</span>
                  </li>
                );
                if (!isOpen || kids.length === 0) {
                  return [parent];
                }
                return [
                  parent,
                  ...kids.map((child) => (
                    <li key={`${bucket.id}:${child.id}`} className="is-child">
                      <span>
                        <i style={{ background: bucketColor(bucket.id) }} />
                        {child.label}
                      </span>
                      <span>{formatTokenCount(child.tokens)}</span>
                    </li>
                  )),
                ];
              })}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
