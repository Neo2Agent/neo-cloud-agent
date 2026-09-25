import { parseUserListEvent } from "@neo-cloud-agent/contracts/client-stream";
import type { MobileClient } from "./api/client.js";

/** Refresh the run list when the control plane says it changed. */
export function attachUserListStream(client: MobileClient, onChange: () => void): () => void {
  const controller = new AbortController();
  const listen = () => {
    void client
      .streamUserList(
        (event) => {
          if (parseUserListEvent(JSON.stringify(event)) || event.kind === "runs.changed") onChange();
        },
        { signal: controller.signal },
      )
      .catch(() => {
        if (!controller.signal.aborted) setTimeout(listen, 800);
      });
  };
  listen();
  return () => controller.abort();
}
