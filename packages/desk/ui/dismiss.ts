import { useEffect, useRef, type RefObject } from "react";

/** Close a popover when the pointer lands outside its root, same as the expert select. */
export function useDismissOnOutside(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node) || root.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, rootRef]);
}
