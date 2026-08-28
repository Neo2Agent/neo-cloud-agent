import type { DeskInboxEvent } from "@neo-cloud-agent/contracts";
import { deskLogger } from "./log.js";

export type DeskInboxHandle = {
  close(): void;
};

/** How long before a dropped stream is dialled again. */
const DEFAULT_RETRY_MS = 3_000;

/** SSE frames are separated by a blank line, and payload lines start with `data:`. */
const FRAME_SEPARATOR = "\n\n";
const DATA_PREFIX = "data:";

const log = deskLogger("inbox");

/**
 * Hold one outbound stream to the control plane.
 *
 * The control plane cannot reach a laptop behind NAT, so remote dispatch has to
 * ride down a connection this machine opened. Holding it is also what marks the
 * desk online, which is why it reconnects on its own.
 */
export function openDeskInboxStream(input: {
  baseUrl: string;
  deskId: string;
  deskToken: string;
  onEvent: (event: DeskInboxEvent) => void;
  onStateChange?: (connected: boolean) => void;
  onUnauthorized?: () => void;
  /** Inbox route is missing on the current production control plane. */
  onUnavailable?: () => void;
  fetchImpl?: typeof fetch;
  retryMs?: number;
}): DeskInboxHandle {
  const root = input.baseUrl.replace(/\/$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  const retryMs = input.retryMs ?? DEFAULT_RETRY_MS;
  let closed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = async (): Promise<void> => {
    if (closed) {
      return;
    }
    controller = new AbortController();
    try {
      const response = await fetchImpl(`${root}/v1/desks/${input.deskId}/inbox`, {
        headers: { authorization: `Bearer ${input.deskToken}`, accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        closed = true;
        input.onUnauthorized?.();
        return;
      }
      if (response.status === 404) {
        closed = true;
        input.onUnavailable?.();
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(`desk inbox ${response.status}`);
      }
      input.onStateChange?.(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf(FRAME_SEPARATOR);
        while (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + FRAME_SEPARATOR.length);
          for (const line of frame.split("\n")) {
            if (!line.startsWith(DATA_PREFIX)) {
              continue;
            }
            try {
              input.onEvent(JSON.parse(line.slice(DATA_PREFIX.length).trim()) as DeskInboxEvent);
            } catch (error) {
              // One bad frame is not worth dropping the stream the whole machine
              // depends on, but it should not vanish either.
              log.warn("skipped a malformed frame", { deskId: input.deskId, detail: String(error) });
            }
          }
          split = buffer.indexOf(FRAME_SEPARATOR);
        }
      }
    } catch (error) {
      if (!closed) {
        log.error("stream dropped, reconnecting", error, { deskId: input.deskId, retryMs });
      }
    } finally {
      input.onStateChange?.(false);
    }
    if (!closed) {
      timer = setTimeout(() => void connect(), retryMs);
      timer.unref?.();
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      controller?.abort();
    },
  };
}
