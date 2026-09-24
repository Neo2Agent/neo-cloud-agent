export type Box = { top: number; left: number; bottom: number; right: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

/** Place the repo menu in the viewport. Prefer above the trigger so the composer does not jump. */
export function placeRepoMenu(
  trigger: Pick<Box, "top" | "left" | "bottom" | "width">,
  menu: Size,
  viewport: Viewport,
  gap = 6,
  pad = 8,
): { top: number; left: number; width: number } {
  const width = Math.min(Math.max(menu.width, 240), Math.max(pad, viewport.width - pad * 2));
  const left = Math.min(Math.max(trigger.left, pad), Math.max(pad, viewport.width - width - pad));
  const height = Math.min(menu.height, Math.max(80, viewport.height - pad * 2));
  const above = trigger.top - gap - height;
  const below = trigger.bottom + gap;
  const fitsAbove = above >= pad;
  const fitsBelow = below + height <= viewport.height - pad;
  const top = fitsAbove || !fitsBelow ? Math.max(pad, above) : below;
  return { top, left, width };
}
