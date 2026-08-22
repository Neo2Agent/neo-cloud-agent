export const NARROW_MQ = "(max-width: 860px)";

export function isNarrowViewport(
  win: Pick<Window, "innerWidth"> & { matchMedia?: Window["matchMedia"] } = window,
): boolean {
  if (typeof win.matchMedia === "function") {
    return win.matchMedia(NARROW_MQ).matches;
  }
  return win.innerWidth < 860;
}

export function shouldSendOnEnter(
  event: { key: string; shiftKey: boolean },
  options?: { narrow?: boolean },
): boolean {
  return event.key === "Enter" && !event.shiftKey && options?.narrow !== true;
}

export function applyVisualViewport(
  style: { setProperty: (name: string, value: string) => void },
  viewport: { height: number; offsetTop: number },
): void {
  style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
  style.setProperty("--app-offset-top", `${Math.round(viewport.offsetTop)}px`);
}

export function bindVisualViewport(
  doc: Document,
  view: Window & { visualViewport?: VisualViewport | null },
): () => void {
  const sync = () => {
    const vv = view.visualViewport;
    applyVisualViewport(doc.documentElement.style, {
      height: vv?.height ?? view.innerHeight,
      offsetTop: vv?.offsetTop ?? 0,
    });
    doc.documentElement.classList.toggle("is-narrow", isNarrowViewport(view));
  };
  sync();
  view.visualViewport?.addEventListener("resize", sync);
  view.visualViewport?.addEventListener("scroll", sync);
  view.addEventListener("resize", sync);
  view.addEventListener("orientationchange", sync);
  return () => {
    view.visualViewport?.removeEventListener("resize", sync);
    view.visualViewport?.removeEventListener("scroll", sync);
    view.removeEventListener("resize", sync);
    view.removeEventListener("orientationchange", sync);
  };
}

export function closeMobileSidebar(): boolean {
  if (!isNarrowViewport()) {
    return false;
  }
  window.localStorage.setItem("neo.sidebar", "0");
  return true;
}
