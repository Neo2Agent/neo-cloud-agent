export const SIDEBAR_DEFAULT = 280;
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 360;
export const PANE_MIN = 260;

/** Session / pane shares of the full viewport, from the Cursor reference frames. */
const SESSION_OPEN_SHARE = 0.33;
const PANE_DEFAULT_SHARE = 0.46;

/** Share of the chat+inspector row where the frame appears. Releasing there enters fullscreen. */
const PANE_SNAP_HINT = 0.68;

export type PaneSnap = "idle" | "hint";

function workspaceWidth(viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  return Math.max(0, viewportWidth - sidebarWidth);
}

/** Right pane default: 46% of the page, leaving ~33% for the open session. */
export function paneDefault(viewportWidth: number, sidebarWidth = SIDEBAR_DEFAULT): number {
  const pane = Math.round(viewportWidth * PANE_DEFAULT_SHARE);
  const sessionFloor = Math.round(viewportWidth * SESSION_OPEN_SHARE);
  const room = workspaceWidth(viewportWidth, sidebarWidth);
  const maxPane = Math.max(PANE_MIN, room - Math.min(sessionFloor, Math.max(0, room - PANE_MIN)));
  return Math.min(maxPane, Math.max(PANE_MIN, pane));
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
