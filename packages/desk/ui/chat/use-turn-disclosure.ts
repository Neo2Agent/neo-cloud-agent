import { useEffect, useRef, useState } from "react";
import { resolveFoldOpen } from "@neo-cloud-agent/contracts/work-view";

/**
 * A click wins until the turn ends. Otherwise only the caller's auto-open
 * flag is open, so a finished tool or group collapses as soon as it stops
 * running. The body stays mounted; closing does not remount the row.
 */
export function useTurnDisclosure(live: boolean, autoOpen = false): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setChoice(null);
    wasLive.current = live;
  }, [live]);
  const open = resolveFoldOpen(live && autoOpen, choice);
  return [open, () => setChoice(!open)];
}
