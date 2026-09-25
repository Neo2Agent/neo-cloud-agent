import type { ContextUsageBucketId, ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { formatContextPercent, formatTokenCount, layoutContextBar } from "@neo-cloud-agent/contracts/context-usage";

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

const BAR_UNITS = 1000;

type Props = {
  usage: ContextUsageSnapshot;
  open: boolean;
  onToggle: () => void;
  onOpenDetail?: (bucketId?: string) => void;
};

function bucketColor(id: string): string {
  return COLORS[id as ContextUsageBucketId] ?? "#9ca3af";
}

function percentLabel(usage: ContextUsageSnapshot): string {
  const percent = formatContextPercent(usage.percent);
  return percent == null ? "窗口未知" : `${percent} 已用`;
}

function totalLabel(usage: ContextUsageSnapshot): string {
  return usage.contextWindow
    ? `~${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} Tokens`
    : `~${formatTokenCount(usage.tokens)} Tokens`;
}

export function ContextUsageBar({ usage, className }: { usage: ContextUsageSnapshot; className?: string }) {
  const layout = layoutContextBar({
    width: BAR_UNITS,
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    buckets: usage.buckets,
  });
  return (
    <div className={className ?? "context-usage-bar"} aria-hidden="true">
      {layout.slices.map((slice) => (
        <i
          key={slice.id}
          title={`${slice.label}  ${formatTokenCount(slice.tokens)}`}
          style={{
            width: `${(slice.width / BAR_UNITS) * 100}%`,
            background: bucketColor(slice.id),
          }}
        />
      ))}
    </div>
  );
}

export function ContextUsageControl({ usage, open, onToggle, onOpenDetail }: Props) {
  const chip = formatContextPercent(usage.percent) ?? "用量";
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
        {chip}
      </button>
      {open ? (
        <>
          <button type="button" className="context-usage-backdrop" aria-label="关闭上下文用量" onClick={onToggle} />
          <div className="context-usage-pop" id="context-usage-pop" role="dialog" aria-label="上下文用量">
            <div className="context-usage-head">
              <span>上下文用量</span>
              <span className="context-usage-actions">
                {onOpenDetail ? (
                  <button
                    type="button"
                    className="context-usage-icon"
                    aria-label="打开明细"
                    title="打开明细"
                    onClick={() => onOpenDetail()}
                  >
                    <ExpandIcon />
                  </button>
                ) : null}
                <button type="button" className="context-usage-icon" aria-label="关闭" onClick={onToggle}>
                  <CloseIcon />
                </button>
              </span>
            </div>
            <p className="context-usage-status">
              <span>{percentLabel(usage)}</span>
              <span>{totalLabel(usage)}</span>
            </p>
            <ContextUsageBar usage={usage} />
            <ul className="context-usage-list">
              {usage.buckets.map((bucket) => (
                <li key={bucket.id}>
                  <span className="context-usage-name">
                    <i style={{ background: bucketColor(bucket.id) }} />
                    {bucket.label}
                  </span>
                  {onOpenDetail && bucket.children?.length ? (
                    <button
                      type="button"
                      className="context-usage-icon"
                      aria-label={`查看${bucket.label}明细`}
                      title={`查看${bucket.label}明细`}
                      onClick={() => onOpenDetail(bucket.id)}
                    >
                      <ExpandIcon size={13} />
                    </button>
                  ) : null}
                  <span className="context-usage-value">{formatTokenCount(bucket.tokens)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z" />
    </svg>
  );
}

function ExpandIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 3h7v7h-2V6.4l-5.3 5.3-1.4-1.4L17.6 5H14V3ZM3 14h2v3.6l5.3-5.3 1.4 1.4L6.4 19H10v2H3v-7Z"
      />
    </svg>
  );
}

export { bucketColor, percentLabel, totalLabel };
