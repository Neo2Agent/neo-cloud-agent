import type { WorkerInbound, WorkerOutbound } from "@neo-cloud-agent/contracts";
import { config } from "./config.js";

export async function pullInbox(runId: string): Promise<WorkerInbound[]> {
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/inbox`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`inbox ${response.status}`);
  }
  const body = (await response.json()) as { messages: WorkerInbound[] };
  return body.messages;
}

export function heartbeat(runId: string, status: "booting" | "ready" | "busy" | "idle"): WorkerOutbound {
  return {
    type: "heartbeat",
    runId,
    diskUsedBytes: 0,
    status,
  };
}
