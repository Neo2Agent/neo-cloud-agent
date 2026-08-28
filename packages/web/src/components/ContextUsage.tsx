import type { ContextUsageBucketId, ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { formatTokenCount } from "@neo-cloud-agent/contracts/context-usage";

const COLORS: Record<ContextUsageBucketId, string> = {
  system: "#9ca3af",
  tools: "#8b5cf6",
  summarized: "#b91c1c",
  conversation: "#f97316",
};

type Props = {
  usage: ContextUsageSnapshot;
  open: boolean;
  onToggle: () => void;
};

export function ContextUsageControl({ usage, open, onToggle }: Props) {
  const percentLabel =
    usage.percent == null ? "用量" : `${Math.max(0, Math.round(usage.percent))}%`;
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
            <div className="context-usage-bar" aria-hidden="true">
              {usage.contextWindow
                ? usage.buckets.map((bucket) => (
                    <i
                      key={bucket.id}
                      style={{
                        width: `${Math.max(0.4, (bucket.tokens / usage.contextWindow!) * 100)}%`,
                        background: COLORS[bucket.id],
                      }}
                    />
                  ))
                : usage.buckets.map((bucket) => (
                    <i
                      key={bucket.id}
                      style={{
                        width: `${Math.max(4, usage.tokens ? (bucket.tokens / usage.tokens) * 100 : 0)}%`,
                        background: COLORS[bucket.id],
                      }}
                    />
                  ))}
            </div>
            <ul className="context-usage-list">
              {usage.buckets.map((bucket) => (
                <li key={bucket.id}>
                  <span>
                    <i style={{ background: COLORS[bucket.id] }} />
                    {bucket.label}
                  </span>
                  <span>{formatTokenCount(bucket.tokens)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
