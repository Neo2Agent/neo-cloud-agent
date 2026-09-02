import { useEffect } from "react";
import type {
  ContextUsageBucket,
  ContextUsageBucketId,
  ContextUsageSnapshot,
} from "@neo-cloud-agent/contracts/context-usage";
import { formatTokenCount, layoutContextBar } from "@neo-cloud-agent/contracts/context-usage";
import { IconBack, IconExpand, IconX } from "../icons";

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
  /** Hand the breakdown to the stage; the popover stays a summary. */
  onOpenDetail?: (bucketId?: string) => void;
};

function bucketColor(id: string): string {
  return COLORS[id as ContextUsageBucketId] ?? "#9ca3af";
}

function percentLabel(usage: ContextUsageSnapshot): string {
  return usage.percent == null ? "窗口未知" : `${Math.max(0, Math.round(usage.percent))}% 已用`;
}

function totalLabel(usage: ContextUsageSnapshot): string {
  return usage.contextWindow
    ? `~${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} Tokens`
    : `~${formatTokenCount(usage.tokens)} Tokens`;
}

function share(tokens: number, total: number): string {
  if (total <= 0) {
    return "";
  }
  const value = (tokens / total) * 100;
  return value >= 1 ? `${Math.round(value)}%` : "<1%";
}

/** Widths come from the shared layout so a 0.3% fill still shows a sliver. */
function UsageBar({ usage, className }: { usage: ContextUsageSnapshot; className?: string }) {
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
  const chip = usage.percent == null ? "用量" : `${Math.max(0, Math.round(usage.percent))}%`;

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
          <button
            type="button"
            className="context-usage-backdrop"
            aria-label="关闭上下文用量"
            onClick={onToggle}
          />
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
                    <IconExpand size={14} />
                  </button>
                ) : null}
                <button type="button" className="context-usage-icon" aria-label="关闭" onClick={onToggle}>
                  <IconX size={14} />
                </button>
              </span>
            </div>
            <p className="context-usage-status">
              <span>{percentLabel(usage)}</span>
              <span>{totalLabel(usage)}</span>
            </p>
            <UsageBar usage={usage} />
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
                      <IconExpand size={13} />
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

function BucketSection({
  bucket,
  total,
  focused,
}: {
  bucket: ContextUsageBucket;
  total: number;
  focused: boolean;
}) {
  const children = bucket.children ?? [];
  const color = bucketColor(bucket.id);
  const widest = children.reduce((max, child) => Math.max(max, child.tokens), 0);

  return (
    <section className="context-section" id={`context-bucket-${bucket.id}`} data-focus={focused ? "true" : undefined}>
      <header>
        <span className="context-usage-name">
          <i style={{ background: color }} />
          {bucket.label}
        </span>
        <span className="context-section-total">
          <b>{formatTokenCount(bucket.tokens)}</b>
          <em>{share(bucket.tokens, total)}</em>
        </span>
      </header>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <li key={child.id}>
              <i
                aria-hidden="true"
                style={{
                  width: `${widest > 0 ? Math.max(2, (child.tokens / widest) * 100) : 0}%`,
                  background: color,
                }}
              />
              <span>{child.label}</span>
              <b>{formatTokenCount(child.tokens)}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Stage page for the breakdown, so the composer popover can stay a summary. */
export function ContextUsagePanel({
  usage,
  focusBucketId,
  onBack,
}: {
  usage: ContextUsageSnapshot;
  focusBucketId?: string;
  onBack: () => void;
}) {
  useEffect(() => {
    if (!focusBucketId) {
      return;
    }
    document.getElementById(`context-bucket-${focusBucketId}`)?.scrollIntoView({ block: "center" });
  }, [focusBucketId]);

  return (
    <section className="proj-page context-page" id="context-page">
      <header className="proj-page-head">
        <div>
          <button className="catalog-back" type="button" onClick={onBack}>
            <IconBack />
            返回对话
          </button>
          <h2>上下文用量</h2>
          <p className="hint">
            {percentLabel(usage)} · {totalLabel(usage)}
            {usage.model ? ` · ${usage.model}` : ""}
          </p>
        </div>
      </header>
      <div className="context-page-body">
        <UsageBar usage={usage} className="context-usage-bar is-wide" />
        <div className="context-sections">
          {usage.buckets.map((bucket) => (
            <BucketSection
              key={bucket.id}
              bucket={bucket}
              total={usage.tokens}
              focused={bucket.id === focusBucketId}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
