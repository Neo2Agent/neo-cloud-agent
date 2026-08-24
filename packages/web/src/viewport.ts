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
  event: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
  options?: { narrow?: boolean },
): boolean {
  if (event.ctrlKey || event.metaKey) {
    return false;
  }
  return event.key === "Enter" && !event.shiftKey && options?.narrow !== true;
}

export function shouldQueueOnCtrlEnter(event: { key: string; ctrlKey?: boolean; shiftKey?: boolean }): boolean {
  return event.key === "Enter" && event.ctrlKey === true && event.shiftKey !== true;
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
  const onFocusIn = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
    const reveal = () => {
      sync();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    view.setTimeout(reveal, 50);
    view.setTimeout(reveal, 350);
  };
  sync();
  view.visualViewport?.addEventListener("resize", sync);
  view.visualViewport?.addEventListener("scroll", sync);
  view.addEventListener("resize", sync);
  view.addEventListener("orientationchange", sync);
  doc.addEventListener("focusin", onFocusIn);
  return () => {
    view.visualViewport?.removeEventListener("resize", sync);
    view.visualViewport?.removeEventListener("scroll", sync);
    view.removeEventListener("resize", sync);
    view.removeEventListener("orientationchange", sync);
    doc.removeEventListener("focusin", onFocusIn);
  };
}

export function closeMobileSidebar(
  win: Pick<Window, "localStorage"> & Parameters<typeof isNarrowViewport>[0] = window,
): boolean {
  if (!isNarrowViewport(win)) {
    return false;
  }
  win.localStorage.setItem("neo.sidebar", "0");
  return true;
}
