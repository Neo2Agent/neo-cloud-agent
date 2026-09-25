import { useEffect } from "react";
import type { ContextUsageBucket, ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { formatContextPercent, formatTokenCount } from "@neo-cloud-agent/contracts/context-usage";
import { ContextUsageBar, bucketColor, percentLabel, totalLabel } from "@neo-cloud-agent/ui";
import { IconBack } from "../icons";

export { ContextUsageControl } from "@neo-cloud-agent/ui";

function share(tokens: number, total: number): string {
  return total > 0 ? (formatContextPercent((tokens / total) * 100) ?? "") : "";
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
        <ContextUsageBar usage={usage} className="context-usage-bar is-wide" />
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
