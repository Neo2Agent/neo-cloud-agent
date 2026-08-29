import {
  applyRunEventsToMessages,
  settleTranscriptMessages,
} from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { MobileClient } from "./api/client.js";
import { applyLiveEvents } from "./stream.js";
import { dropResolvedPendingUsers, isTerminalTurnEvent, statusFromEventKind } from "./turn.js";

export function attachRunStream(
  client: MobileClient,
  runId: string,
  after: string | null | undefined,
  handlers: {
    onMessages: (updater: (prev: TranscriptMessage[]) => TranscriptMessage[]) => void;
    onStatus?: (status: string) => void;
    onEventId?: (id: string) => void;
  },
): () => void {
  const controller = new AbortController();
  const pending: RunEvent[] = [];
  let timer: number | ReturnType<typeof setTimeout> | 0 = 0;
  let usedRaf = false;
  let lastId = after ?? null;

  const flush = () => {
    timer = 0;
    const batch = applyLiveEvents([], pending.splice(0));
    if (batch.length === 0) return;
    handlers.onMessages((prev) => {
      const next = dropResolvedPendingUsers(applyRunEventsToMessages(prev, batch));
      return batch.some((event) => isTerminalTurnEvent(event.kind)) ? settleTranscriptMessages(next) : next;
    });
    for (const event of batch) {
      lastId = event.id;
      handlers.onEventId?.(event.id);
      const status = statusFromEventKind(event.kind);
      if (status) handlers.onStatus?.(status);
    }
  };

  const schedule = () => {
    if (timer) return;
    if (typeof requestAnimationFrame === "function") {
      usedRaf = true;
      timer = requestAnimationFrame(flush);
      return;
    }
    usedRaf = false;
    timer = setTimeout(flush, 16);
  };

  const cancelTimer = () => {
    if (!timer) return;
    if (usedRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(Number(timer));
    } else {
      clearTimeout(timer);
    }
    timer = 0;
  };

  const listen = (resumeAfter?: string | null) => {
    void client
      .streamEvents(
        runId,
        (event) => {
          pending.push(event);
          schedule();
        },
        { after: resumeAfter ?? lastId, signal: controller.signal },
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setTimeout(() => listen(lastId), 800);
        }
      });
  };

  listen(after);

  return () => {
    controller.abort();
    cancelTimer();
  };
}
