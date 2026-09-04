import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  FollowUpDelivery,
  ImageRef,
  Run,
  StartTurnRequest,
  StartTurnResponse,
  TurnCompleteRequest,
  TurnHeartbeatRequest,
  TurnSignalRequest,
} from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { workspaceFor } from "../worker-spawn.js";

const pendingFollowUps = new Map<string, Array<{ text: string; images?: ImageRef[]; followUpId?: string }>>();
const loopHeartbeats = new Map<string, number>();

export function noteLoopHeartbeat(runId: string, at = Date.now()): void {
  loopHeartbeats.set(runId, at);
}

export function isLoopAttached(runId: string, at = Date.now(), timeoutMs = 45_000): boolean {
  const seen = loopHeartbeats.get(runId);
  return Boolean(seen && at - seen < timeoutMs);
}

export function clearLoopHeartbeat(runId: string): void {
  loopHeartbeats.delete(runId);
}

function loopHeaders(): Record<string, string> {
  const token = getConfig().neoLoopToken;
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function readWorkspaceText(runId: string, relative: string): string | undefined {
  try {
    return readFileSync(path.join(workspaceFor(runId), relative), "utf8");
  } catch {
    return undefined;
  }
}

export function buildStartTurnRequest(
  run: Run,
  input: { turnId: string; delivery: FollowUpDelivery; text: string; images?: ImageRef[]; followUpId?: string | null },
): StartTurnRequest {
  const config = getConfig();
  return {
    runId: run.id,
    turnId: input.turnId,
    orgId: run.orgId,
    userId: run.userId,
    delivery: input.delivery,
    text: input.text,
    images: input.images,
    model: run.model,
    jwt: "",
    llmGatewayUrl: config.llmGatewayUrl,
    controlPlaneUrl: config.controlPlaneUrl,
    tools: {
      mode: "worker_ws",
      url: "inbound",
      sandboxRoot: "/workspace",
    },
    workspace: {
      agentsMd: readWorkspaceText(run.id, "AGENTS.md") ?? readWorkspaceText(run.id, "CLAUDE.md"),
      expertMd: readWorkspaceText(run.id, ".neo/EXPERT.md") ?? readWorkspaceText(run.id, ".neo/EXPERT_TEAM.md"),
      skillRoots: [".neo/skills", ".cursor/skills", ".agents/skills", ".pi/skills"],
    },
    followUpId: input.followUpId ?? null,
  };
}

export async function dispatchTurn(
  run: Run,
  jwt: string,
  input: { delivery: FollowUpDelivery; text: string; images?: ImageRef[]; followUpId?: string | null },
): Promise<StartTurnResponse | null> {
  const config = getConfig();
  if ((run.kernel ?? "pi") !== "agentscope") {
    return null;
  }
  const turnId = crypto.randomUUID();
  run.currentTurnId = turnId;
  const body = buildStartTurnRequest(run, { ...input, turnId });
  body.jwt = jwt;
  const response = await fetch(`${config.neoLoopUrl}/internal/loop/turns`, {
    method: "POST",
    headers: loopHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`neo-loop turn ${response.status}`);
  }
  return (await response.json()) as StartTurnResponse;
}

export async function signalTurn(run: Run, signal: TurnSignalRequest): Promise<void> {
  const config = getConfig();
  const turnId = run.currentTurnId;
  if (!turnId) {
    throw new Error("no current turn");
  }
  const response = await fetch(`${config.neoLoopUrl}/internal/loop/turns/${encodeURIComponent(turnId)}/signal`, {
    method: "POST",
    headers: loopHeaders(),
    body: JSON.stringify(signal),
  });
  if (!response.ok) {
    throw new Error(`neo-loop signal ${response.status}`);
  }
}

export function queueLoopFollowUp(runId: string, item: { text: string; images?: ImageRef[]; followUpId?: string }): void {
  const list = pendingFollowUps.get(runId) ?? [];
  list.push(item);
  pendingFollowUps.set(runId, list);
}

export function takeQueuedLoopFollowUp(runId: string): { text: string; images?: ImageRef[]; followUpId?: string } | undefined {
  const list = pendingFollowUps.get(runId) ?? [];
  const next = list.shift();
  pendingFollowUps.set(runId, list);
  return next;
}

export function hasQueuedLoopFollowUp(runId: string): boolean {
  return (pendingFollowUps.get(runId) ?? []).length > 0;
}

export function applyTurnComplete(run: Run, body: TurnCompleteRequest): void {
  if (run.currentTurnId && body.turnId !== run.currentTurnId) {
    return;
  }
  run.currentTurnId = null;
}

export function applyTurnHeartbeat(runId: string, _body: TurnHeartbeatRequest): void {
  noteLoopHeartbeat(runId);
}
