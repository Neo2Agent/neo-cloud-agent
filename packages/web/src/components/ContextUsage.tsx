import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  ContextBarLayout,
  ContextUsageBucket,
  ContextUsageBucketId,
  ContextUsageSnapshot,
} from "@neo-cloud-agent/contracts/context-usage";
import { formatTokenCount, hitTestBar, layoutContextBar } from "@neo-cloud-agent/contracts/context-usage";

export const CONTEXT_BUCKET_COLORS: Record<ContextUsageBucketId, string> = {
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

type Highlight = { parentId: string; childId?: string };

type Props = {
  usage: ContextUsageSnapshot;
  open: boolean;
  onToggle: () => void;
};

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    media.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [dpr]);
  return dpr;
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const value = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgb(values: [number, number, number], alpha = 1): string {
  return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
}

function mixHex(hex: string, toward: [number, number, number], amount: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [
    Math.round(r + (toward[0] - r) * amount),
    Math.round(g + (toward[1] - g) * amount),
    Math.round(b + (toward[2] - b) * amount),
  ];
}

function childTone(parent: string, index: number): string {
  const toward: [number, number, number] = index % 2 === 0 ? [255, 255, 255] : [0, 0, 0];
  return rgb(mixHex(parent, toward, index % 2 === 0 ? 0.22 : 0.14));
}

function bucketColor(id: string): string {
  return CONTEXT_BUCKET_COLORS[id as ContextUsageBucketId] ?? "#9ca3af";
}

function paintBar(
  canvas: HTMLCanvasElement,
  layout: ContextBarLayout,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  highlight: Highlight | null,
  revealParentId: string | null,
): void {
  const ratio = Math.max(1, dpr);
  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const radius = cssHeight / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, cssWidth, cssHeight, radius);
  ctx.clip();

  ctx.fillStyle = "#e8eaee";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  for (const slice of layout.slices) {
    const parentColor = bucketColor(slice.id);
    const active = highlight?.parentId === slice.id && !highlight.childId;
    const kids = layout.children[slice.id] ?? [];
    const reveal = revealParentId === slice.id && kids.length > 0;
    if (reveal) {
      for (const [index, child] of kids.entries()) {
        const childActive = highlight?.parentId === slice.id && highlight.childId === child.id;
        ctx.fillStyle = childActive ? rgb(mixHex(parentColor, [255, 255, 255], 0.35)) : childTone(parentColor, index);
        ctx.fillRect(child.x, 0, Math.max(0.5, child.width), cssHeight);
      }
    } else {
      ctx.fillStyle = active ? rgb(mixHex(parentColor, [255, 255, 255], 0.28)) : parentColor;
      ctx.fillRect(slice.x, 0, Math.max(0.5, slice.width), cssHeight);
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(0, 0, cssWidth, 1.2);

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (const slice of layout.slices.slice(1)) {
    ctx.beginPath();
    ctx.moveTo(slice.x + 0.5, 0);
    ctx.lineTo(slice.x + 0.5, cssHeight);
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0.4, 0.4, cssWidth - 0.8, cssHeight - 0.8, radius);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

function ContextBarCanvas({
  usage,
  highlight,
  revealParentId,
  onHighlight,
  height = 10,
}: {
  usage: ContextUsageSnapshot;
  highlight: Highlight | null;
  revealParentId: string | null;
  onHighlight: (next: Highlight | null) => void;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);
  const dpr = useDevicePixelRatio();
  const layout = useMemo(
    () =>
      layoutContextBar({
        width,
        tokens: usage.tokens,
        contextWindow: usage.contextWindow,
        buckets: usage.buckets,
      }),
    [usage, width],
  );
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) {
      return;
    }
    paintBar(canvas, layout, width, height, dpr, highlight, revealParentId);
  }, [layout, width, height, dpr, highlight, revealParentId]);

  const describe = (parentId: string, childId?: string): string => {
    const bucket = usage.buckets.find((item) => item.id === parentId);
    if (!bucket) {
      return "";
    }
    if (childId) {
      const child = bucket.children?.find((item) => item.id === childId);
      if (child) {
        return `${bucket.label} · ${child.label}  ${formatTokenCount(child.tokens)}`;
      }
    }
    return `${bucket.label}  ${formatTokenCount(bucket.tokens)}`;
  };

  return (
    <div className="context-usage-bar" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="context-usage-canvas"
        height={height}
        aria-hidden="true"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const parentHit = hitTestBar(layout, x, false);
          const hit =
            parentHit && revealParentId === parentHit.parentId ? hitTestBar(layout, x, true) : parentHit;
          if (!hit) {
            onHighlight(null);
            setTip(null);
            return;
          }
          const next: Highlight = { parentId: hit.parentId, childId: hit.child?.id };
          onHighlight(next);
          setTip({ x, text: describe(hit.parentId, hit.child?.id) });
        }}
        onMouseLeave={() => {
          onHighlight(null);
          setTip(null);
        }}
      />
      {tip ? (
        <span className="context-usage-tip" style={{ left: Math.min(Math.max(tip.x, 16), width - 16) }}>
          {tip.text}
        </span>
      ) : null}
    </div>
  );
}

function ContextChipSpark({ usage }: { usage: ContextUsageSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const width = 36;
  const height = 6;
  const layout = useMemo(
    () =>
      layoutContextBar({
        width,
        tokens: usage.tokens,
        contextWindow: usage.contextWindow,
        buckets: usage.buckets,
        minUsedPx: 6,
        minSegmentPx: 1,
      }),
    [usage],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    paintBar(canvas, layout, width, height, dpr, null, null);
  }, [layout, dpr]);
  return <canvas ref={canvasRef} className="context-usage-chip-bar" width={width} height={height} aria-hidden="true" />;
}

function LegendRow({
  bucket,
  expanded,
  highlight,
  onToggle,
  onHighlight,
}: {
  bucket: ContextUsageBucket;
  expanded: boolean;
  highlight: Highlight | null;
  onToggle: () => void;
  onHighlight: (next: Highlight | null) => void;
}) {
  const color = bucketColor(bucket.id);
  const expandable = Boolean(bucket.children?.length);
  const active = highlight?.parentId === bucket.id && !highlight.childId;
  return (
    <li>
      <button
        type="button"
        className={`context-usage-row${active ? " is-active" : ""}`}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? onToggle : undefined}
        onMouseEnter={() => onHighlight({ parentId: bucket.id })}
        onMouseLeave={() => onHighlight(null)}
      >
        <span>
          <i style={{ background: color }} />
          {bucket.label}
          {expandable ? <em>{bucket.children!.length}</em> : null}
        </span>
        <span>
          {formatTokenCount(bucket.tokens)}
          {expandable ? <b className="context-usage-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</b> : null}
        </span>
      </button>
      {expanded && expandable ? (
        <ul className="context-usage-children">
          {bucket.children!.map((child, index) => {
            const childActive = highlight?.parentId === bucket.id && highlight.childId === child.id;
            return (
              <li key={child.id}>
                <button
                  type="button"
                  className={`context-usage-row is-child${childActive ? " is-active" : ""}`}
                  onMouseEnter={() => onHighlight({ parentId: bucket.id, childId: child.id })}
                  onMouseLeave={() => onHighlight({ parentId: bucket.id })}
                >
                  <span>
                    <i style={{ background: childTone(color, index) }} />
                    {child.label}
                  </span>
                  <span>{formatTokenCount(child.tokens)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function ContextUsageControl({ usage, open, onToggle }: Props) {
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const percentLabel = usage.percent == null ? "用量" : `${Math.max(0, Math.round(usage.percent))}%`;
  const total = usage.contextWindow
    ? `~${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} Tokens`
    : `~${formatTokenCount(usage.tokens)} Tokens · 窗口未知`;
  const revealParentId = highlight?.parentId && expanded[highlight.parentId] ? highlight.parentId : null;

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
        <ContextChipSpark usage={usage} />
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
            <ContextBarCanvas
              usage={usage}
              highlight={highlight}
              revealParentId={revealParentId}
              onHighlight={setHighlight}
            />
            <ul className="context-usage-list">
              {usage.buckets.map((bucket) => (
                <LegendRow
                  key={bucket.id}
                  bucket={bucket}
                  expanded={Boolean(expanded[bucket.id])}
                  highlight={highlight}
                  onToggle={() =>
                    setExpanded((current) => ({ ...current, [bucket.id]: !current[bucket.id] }))
                  }
                  onHighlight={setHighlight}
                />
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
