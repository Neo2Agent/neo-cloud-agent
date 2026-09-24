export type Box = { top: number; left: number; bottom: number; right: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

export function repoMenuAlignElement(trigger: HTMLElement): HTMLElement {
  const composer = trigger.closest("#composer");
  const box = composer?.querySelector(".composer-box");
  if (box instanceof HTMLElement) return box;
  if (composer instanceof HTMLElement) return composer;
  return trigger;
}

/** Place the repo menu in the viewport. Prefer above the trigger so the composer does not jump. */
export function placeRepoMenu(input: {
  trigger: Pick<Box, "top" | "left" | "bottom" | "width">;
  menu: Size;
  viewport: Viewport;
  align?: Pick<Box, "left" | "width">;
  gap?: number;
  pad?: number;
}): { top: number; left: number; width: number } {
  const gap = input.gap ?? 4;
  const pad = input.pad ?? 8;
  const maxWidth = Math.max(pad, input.viewport.width - pad * 2);
  const preferred = input.align?.width ?? input.menu.width;
  const width = Math.min(Math.max(preferred, 200), maxWidth);
  const preferredLeft = input.align?.left ?? input.trigger.left;
  const left = Math.min(Math.max(preferredLeft, pad), Math.max(pad, input.viewport.width - width - pad));
  const height = Math.min(input.menu.height, Math.max(80, input.viewport.height - pad * 2));
  const above = input.trigger.top - gap - height;
  const below = input.trigger.bottom + gap;
  const fitsAbove = above >= pad;
  const fitsBelow = below + height <= input.viewport.height - pad;
  const top = fitsAbove || !fitsBelow ? Math.max(pad, above) : below;
  return { top, left, width };
}
