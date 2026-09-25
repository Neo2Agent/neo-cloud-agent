export type Box = { top: number; left: number; bottom: number; right: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

export function repoMenuClampElement(trigger: HTMLElement): HTMLElement {
  const composer = trigger.closest("#composer");
  const box = composer?.querySelector(".composer-box");
  if (box instanceof HTMLElement) return box;
  if (composer instanceof HTMLElement) return composer;
  return trigger;
}

/** Compact dropdown: hang from the trigger, stay inside the composer/viewport. */
export function placeRepoMenu(input: {
  trigger: Pick<Box, "top" | "left" | "bottom" | "width">;
  menu: Size;
  viewport: Viewport;
  clamp?: Pick<Box, "left" | "width">;
  gap?: number;
  pad?: number;
  maxMenuWidth?: number;
}): { top: number; left: number; width: number } {
  const gap = input.gap ?? 4;
  const pad = input.pad ?? 8;
  const maxMenuWidth = input.maxMenuWidth ?? 300;
  const viewportMax = Math.max(pad, input.viewport.width - pad * 2);
  const clampMax = input.clamp?.width ?? viewportMax;
  const width = Math.min(Math.max(input.menu.width, 220), maxMenuWidth, clampMax, viewportMax);
  const minLeft = Math.max(pad, input.clamp?.left ?? pad);
  const clampRight = input.clamp ? input.clamp.left + input.clamp.width : input.viewport.width - pad;
  const maxLeft = Math.max(minLeft, Math.min(input.viewport.width - width - pad, clampRight - width));
  const left = Math.min(Math.max(input.trigger.left, minLeft), maxLeft);
  const height = Math.min(input.menu.height, Math.max(80, input.viewport.height - pad * 2));
  const above = input.trigger.top - gap - height;
  const below = input.trigger.bottom + gap;
  const fitsAbove = above >= pad;
  const fitsBelow = below + height <= input.viewport.height - pad;
  const top = fitsAbove || !fitsBelow ? Math.max(pad, above) : below;
  return { top, left, width };
}
