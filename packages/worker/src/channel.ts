import { redactRunEvent, redactText, secretValuesFromEnv, type RunEvent, type WorkerInbound } from "@neo-cloud-agent/contracts";
import { getWorkerConfig } from "./config.js";

function workerSecrets(extra: string[] = []): string[] {
  const config = getWorkerConfig();
  return secretValuesFromEnv(process.env, [config.llmGatewayJwt, ...extra].filter(Boolean));
}

function workerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const jwt = getWorkerConfig().llmGatewayJwt;
  return jwt ? { ...extra, authorization: `Bearer ${jwt}` } : extra;
}

export async function pullInbox(runId: string): Promise<WorkerInbound[]> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/inbox`, {
    method: "POST",
    headers: workerHeaders(),
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
  const secrets = workerSecrets();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/events`, {
    method: "POST",
    headers: workerHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ events: events.map((item) => redactRunEvent(item, secrets)) }),
  });
  if (!response.ok) {
    throw new Error(`events ${response.status}`);
  }
}

export async function requestGitToken(
  runId: string,
  input: { repoUrl?: string; scope: "clone" | "push" },
): Promise<{ token: string; expiresAt: string; scope: string; repoUrl: string }> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/scm/token`, {
    method: "POST",
    headers: workerHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`git token ${response.status}`);
  }
  return (await response.json()) as { token: string; expiresAt: string; scope: string; repoUrl: string };
}

export async function requestCommit(runId: string, input: { message: string; paths?: string[] }) {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/scm/commit`, {
    method: "POST",
    headers: workerHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`commit ${response.status}`);
  }
  return response.json();
}

export async function requestPullRequest(
  runId: string,
  input: { title: string; body?: string; remoteUrl?: string },
) {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/scm/pull-request`, {
    method: "POST",
    headers: workerHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`pull request ${response.status}`);
  }
  return response.json();
}

export async function downloadSession(runId: string): Promise<Array<{ name: string; content: string }>> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/session`, {
    headers: workerHeaders(),
  });
  if (!response.ok) {
    throw new Error(`session ${response.status}`);
  }
  const body = (await response.json()) as { files?: Array<{ name: string; content?: string }> };
  return (body.files ?? [])
    .filter((file): file is { name: string; content: string } => Boolean(file.name) && typeof file.content === "string")
    .map((file) => ({ name: file.name, content: file.content }));
}

export async function uploadSession(runId: string, files: Array<{ name: string; content: string }>): Promise<void> {
  if (files.length === 0) {
    return;
  }
  const config = getWorkerConfig();
  const secrets = workerSecrets();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/session`, {
    method: "POST",
    headers: workerHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      files: files.map((file) => ({ name: file.name, content: redactText(file.content, secrets) })),
    }),
  });
  if (!response.ok) {
    throw new Error(`session ${response.status}`);
  }
}

export async function fetchBootstrap(runId: string): Promise<{
  jwt: string;
  llmGatewayUrl: string;
  workspaceDir: string;
  model: string;
}> {
  const config = getWorkerConfig();
  const response = await fetch(`${config.controlPlaneUrl}/internal/runs/${runId}/bootstrap`, {
    headers: workerHeaders(),
  });
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
