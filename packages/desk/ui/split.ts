import { useCallback, useRef, useState, type PointerEvent } from "react";

export const RAIL_W_KEY = "neo-desk-rail-w";
export const PANEL_W_KEY = "neo-desk-panel-w";
export const RAIL_W_MIN = 248;
export const RAIL_W_MAX = 360;
export const RAIL_W_DEFAULT = 248;
export const PANEL_W_MIN = 360;
export const PANEL_W_DEFAULT = 560;

export function clampWidth(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return clampWidth(Math.round(n), min, max);
  } catch {
    return fallback;
  }
}

export function writeStoredWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    /* quota / private mode */
  }
}

export function panelWidthMax(vw = typeof window === "undefined" ? 1280 : window.innerWidth): number {
  return Math.max(PANEL_W_MIN, Math.round(vw * 0.8));
}

type SplitOpts = {
  key: string;
  fallback: number;
  min: number;
  max: number | (() => number);
  invert?: boolean;
};

export function useSplitWidth({ key, fallback, min, max, invert }: SplitOpts) {
  const resolveMax = useCallback(() => (typeof max === "function" ? max() : max), [max]);
  const [width, setWidth] = useState(() => readStoredWidth(key, fallback, min, resolveMax()));
  const widthRef = useRef(width);
  widthRef.current = width;
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events / missing capture */
    }
    drag.current = { startX: event.clientX, startW: widthRef.current };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!drag.current) return;
      const delta = invert ? drag.current.startX - event.clientX : event.clientX - drag.current.startX;
      const next = clampWidth(Math.round(drag.current.startW + delta), min, resolveMax());
      widthRef.current = next;
      setWidth(next);
    },
    [invert, min, resolveMax],
  );

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    writeStoredWidth(key, widthRef.current);
  }, [key]);

  return {
    width,
    dragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
