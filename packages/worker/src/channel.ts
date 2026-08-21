import type { RunEvent, WorkerInbound } from "@neo-cloud-agent/contracts";
import { getWorkerConfig } from "./config.js";

export async function pullInbox(runId: string): Promise<WorkerInbound[]> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/inbox`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`inbox ${response.status}`);
  }
  const body = (await response.json()) as { messages: WorkerInbound[] };
  return body.messages;
}

export async function pushEvents(runId: string, events: RunEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!response.ok) {
    throw new Error(`events ${response.status}`);
  }
}

export async function fetchBootstrap(runId: string): Promise<{
  jwt: string;
  llmGatewayUrl: string;
  workspaceDir: string;
  model: string;
}> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/bootstrap`);
  if (!response.ok) {
    throw new Error(`bootstrap ${response.status}`);
  }
  const body = (await response.json()) as {
    jwt: string;
    llmGatewayUrl: string;
    workspaceDir: string;
    run: { model: string };
  };
  return {
    jwt: body.jwt,
    llmGatewayUrl: body.llmGatewayUrl,
    workspaceDir: body.workspaceDir,
    model: body.run.model,
  };
}
