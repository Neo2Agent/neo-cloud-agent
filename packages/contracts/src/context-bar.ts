/**
 * Pixel layout for the context-usage bar. Kept free of canvas so the
 * proportions can be tested without a browser: the used region is the real
 * fill of the window (with a small floor so a sliver stays visible), and
 * segments share that region by token share. A per-segment floor is taken
 * from the larger slices instead of being stacked onto the full bar — that
 * stacking was what made every bucket look the same width at 0.3% full.
 */

export type ContextBarSlice = {
  id: string;
  label: string;
  tokens: number;
  x: number;
  width: number;
};

export type ContextBarLayout = {
  /** Width of the coloured used region, in CSS pixels. */
  used: number;
  slices: ContextBarSlice[];
  /** Child slices keyed by parent bucket id, already placed inside the parent. */
  children: Record<string, ContextBarSlice[]>;
};

export type ContextBarBucket = {
  id: string;
  label: string;
  tokens: number;
  children?: Array<{ id: string; label: string; tokens: number }>;
};

const DEFAULT_MIN_USED = 10;
const DEFAULT_MIN_SEGMENT = 2;

/** Split `total` across `shares` without inventing extra width. */
export function allocateWidths(shares: number[], total: number, min: number): number[] {
  const n = shares.length;
  if (n === 0) {
    return [];
  }
  if (total <= 0) {
    return shares.map(() => 0);
  }
  const sum = shares.reduce((acc, value) => acc + Math.max(0, value), 0);
  if (sum <= 0) {
    return shares.map(() => total / n);
  }
  if (min * n > total) {
    return shares.map((value) => (Math.max(0, value) / sum) * total);
  }
  const widths = shares.map((value) => Math.max(min, (Math.max(0, value) / sum) * total));
  let drift = widths.reduce((acc, value) => acc + value, 0) - total;
  if (drift > 0) {
    const order = widths
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value);
    for (const { index } of order) {
      const take = Math.min(widths[index] - min, drift);
      widths[index] -= take;
      drift -= take;
      if (drift <= 1e-6) {
        break;
      }
    }
  } else if (drift < 0) {
    let largest = 0;
    for (let i = 1; i < widths.length; i += 1) {
      if (widths[i] > widths[largest]) {
        largest = i;
      }
    }
    widths[largest] -= drift;
  }
  return widths;
}

export function layoutContextBar(input: {
  width: number;
  tokens: number;
  contextWindow: number | null;
  buckets: ContextBarBucket[];
  minUsedPx?: number;
  minSegmentPx?: number;
}): ContextBarLayout {
  const width = Math.max(0, input.width);
  const tokens = Math.max(0, input.tokens);
  const minUsed = input.minUsedPx ?? DEFAULT_MIN_USED;
  const minSegment = input.minSegmentPx ?? DEFAULT_MIN_SEGMENT;
  const visible = input.buckets.filter((bucket) => bucket.tokens > 0);
  if (width <= 0 || tokens <= 0 || visible.length === 0) {
    return { used: 0, slices: [], children: {} };
  }
  const window = input.contextWindow;
  const fill = window && window > 0 ? Math.min(1, tokens / window) : 1;
  const used = Math.min(width, Math.max(fill > 0 ? Math.min(minUsed, width) : 0, width * fill));
  const widths = allocateWidths(
    visible.map((bucket) => bucket.tokens),
    used,
    minSegment,
  );
  const slices: ContextBarSlice[] = [];
  const children: Record<string, ContextBarSlice[]> = {};
  let x = 0;
  for (let i = 0; i < visible.length; i += 1) {
    const bucket = visible[i];
    const sliceWidth = widths[i] ?? 0;
    slices.push({
      id: bucket.id,
      label: bucket.label,
      tokens: bucket.tokens,
      x,
      width: sliceWidth,
    });
    const kids = (bucket.children ?? []).filter((item) => item.tokens > 0);
    if (kids.length > 0 && sliceWidth > 0) {
      const childWidths = allocateWidths(
        kids.map((item) => item.tokens),
        sliceWidth,
        Math.min(1, minSegment),
      );
      let childX = x;
      children[bucket.id] = kids.map((item, index) => {
        const next: ContextBarSlice = {
          id: item.id,
          label: item.label,
          tokens: item.tokens,
          x: childX,
          width: childWidths[index] ?? 0,
        };
        childX += next.width;
        return next;
      });
    }
    x += sliceWidth;
  }
  return { used, slices, children };
}

export function hitTestBar(layout: ContextBarLayout, x: number, preferChildren = true): {
  slice: ContextBarSlice;
  parentId: string;
  child?: ContextBarSlice;
} | null {
  for (const slice of layout.slices) {
    if (x < slice.x || x > slice.x + slice.width) {
      continue;
    }
    const kids = layout.children[slice.id] ?? [];
    if (preferChildren) {
      for (const child of kids) {
        if (x >= child.x && x <= child.x + child.width) {
          return { slice, parentId: slice.id, child };
        }
      }
    }
    return { slice, parentId: slice.id };
  }
  return null;
}
