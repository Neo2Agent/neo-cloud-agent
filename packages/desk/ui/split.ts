import { PANE_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, paneCeiling, paneDefault } from "@neo-cloud-agent/ui/pane-size";
import { useCallback, useRef, useState, type PointerEvent } from "react";

export { paneCeiling, paneDefault, paneSnapPhase, type PaneSnap } from "@neo-cloud-agent/ui/pane-size";

export const RAIL_W_KEY = "neo-desk-rail-w";
export const PANEL_W_KEY = "neo-desk-panel-w";
/** Same rail as Web: 280 wide, draggable 220–360. */
export const RAIL_W_MIN = SIDEBAR_MIN;
export const RAIL_W_MAX = SIDEBAR_MAX;
export const RAIL_W_DEFAULT = SIDEBAR_DEFAULT;
export const PANEL_W_MIN = PANE_MIN;

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

export function panelWidthMax(vw = typeof window === "undefined" ? 1280 : window.innerWidth, sidebar = RAIL_W_DEFAULT): number {
  return paneCeiling(vw, sidebar);
}

export function panelWidthDefault(vw = typeof window === "undefined" ? 1280 : window.innerWidth, sidebar = RAIL_W_DEFAULT): number {
  return paneDefault(vw, sidebar);
}

type SplitOpts = {
  key: string;
  fallback: number;
  min: number;
  max: number | (() => number);
  invert?: boolean;
  /** Web does not restore a previous drag. Desk matches that on each launch. */
  remember?: boolean;
};

export function useSplitWidth({ key, fallback, min, max, invert, remember = false }: SplitOpts) {
  const resolveMax = useCallback(() => (typeof max === "function" ? max() : max), [max]);
  const [width, setWidthState] = useState(() => (remember ? readStoredWidth(key, fallback, min, resolveMax()) : fallback));
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
      setWidthState(next);
    },
    [invert, min, resolveMax],
  );

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (remember) writeStoredWidth(key, widthRef.current);
  }, [key, remember]);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampWidth(Math.round(next), min, resolveMax());
      widthRef.current = clamped;
      setWidthState(clamped);
    },
    [min, resolveMax],
  );

  const commit = useCallback(
    (next: number) => {
      setWidth(next);
      if (remember) writeStoredWidth(key, widthRef.current);
    },
    [key, remember, setWidth],
  );

  return {
    width,
    dragging,
    setWidth,
    commit,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
