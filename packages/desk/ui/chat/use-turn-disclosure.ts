import { useEffect, useRef, useState } from "react";
import { resolveFoldOpen } from "@neo-cloud-agent/contracts/work-view";

/**
 * A click sticks for the whole turn. A section that auto-opened stays open
 * while the turn is live, and both clear once, when the turn settles.
 *
 * `live` flickering for a single event must not collapse the row: that is the
 * open/close flash during a tool stream.
 */
export function useTurnDisclosure(live: boolean, autoOpen = false): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [latched, setLatched] = useState(autoOpen);
  const wasLive = useRef(live);
  useEffect(() => {
    if (autoOpen) setLatched(true);
  }, [autoOpen]);
  useEffect(() => {
    if (wasLive.current && !live) {
      setChoice(null);
      setLatched(false);
    }
    wasLive.current = live;
  }, [live]);
  const open = resolveFoldOpen(autoOpen || latched, choice);
  return [open, () => setChoice(!open)];
}
