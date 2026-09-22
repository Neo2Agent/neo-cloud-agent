export const SIDEBAR_DEFAULT = 240;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const PANE_MIN = 260;

/** Share of the chat+inspector row where the frame appears. Releasing there enters fullscreen. */
export const PANE_SNAP_HINT = 0.68;

export type PaneSnap = "idle" | "hint";

export function workspaceWidth(viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  return Math.max(0, viewportWidth - sidebarWidth);
}

/** Half of the row shared with the chat column, never below the pane floor. */
export function paneHalf(viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  return Math.max(PANE_MIN, Math.round(workspaceWidth(viewportWidth, sidebarWidth) / 2));
}

/** Physical edge of the row. Dragging has no smaller design cap. */
export function paneCeiling(viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  return Math.max(PANE_MIN, workspaceWidth(viewportWidth, sidebarWidth));
}

export function clampPane(width: number, viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  return Math.min(paneCeiling(viewportWidth, sidebarWidth), Math.max(PANE_MIN, Math.round(width)));
}

export function paneSnapPhase(width: number, viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): PaneSnap {
  const room = workspaceWidth(viewportWidth, sidebarWidth);
  if (room <= 0) return "idle";
  return width / room >= PANE_SNAP_HINT ? "hint" : "idle";
}
