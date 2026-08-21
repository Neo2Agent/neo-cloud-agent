import type {
  CreateFollowUpRequest,
  CreateRunRequest,
  FollowUp,
  FollowUpDelivery,
  Run,
  RunEvent,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { config } from "../config.js";
import { publish } from "../events/bus.js";
import { DockerRuntime } from "../runtime/docker.js";

const runs = new Map<string, Run>();
const followUps = new Map<string, FollowUp[]>();
const inbound = new Map<string, WorkerInbound[]>();
const runtime = new DockerRuntime();

function now(): string {
  return new Date().toISOString();
}

function event(runId: string, kind: RunEvent["kind"], title: string, extra?: Partial<RunEvent>): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    createdAt: now(),
    category: kind.startsWith("run.install") ? "agent_setup" : kind.startsWith("run.") ? "agent_setup" : "agent_run",
    level: kind === "run.error" ? "error" : "info",
    kind,
    title,
    ...extra,
  };
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
  const createdAt = now();
  const run: Run = {
    id: crypto.randomUUID(),
    orgId: config.orgId,
    userId: config.userId,
    envId: input.envId ?? null,
    envVersionId: null,
    buildId: null,
    status: "PROVISIONING",
    setupStatus: null,
    source: input.source ?? "api",
    model: input.model ?? config.defaultModel,
    prompt: input.prompt,
    branchName: null,
    repoUrls: input.repoUrls,
    workerHandle: null,
    createdAt,
    updatedAt: createdAt,
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
  };
  runs.set(run.id, run);
  followUps.set(run.id, []);
  inbound.set(run.id, [{ type: "prompt", text: input.prompt, images: input.images }]);
  publish(event(run.id, "run.provisioning", "Provisioning worker"));

  const handle = await runtime.provision({
    runId: run.id,
    image: config.workerImage,
    snapshotId: null,
    cpu: 2,
    memoryMiB: 4096,
    diskGiB: 40,
    egress: { mode: "allow_all", domains: [] },
  });
  run.workerHandle = handle.id;
  run.status = "RUNNING";
  run.updatedAt = now();
  publish(event(run.id, "run.running", "Worker provisioned (P0 stub: no container start yet)"));
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function listRuns(): Run[] {
  return [...runs.values()];
}

export function enqueueFollowUp(runId: string, input: CreateFollowUpRequest): FollowUp {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  const delivery: FollowUpDelivery =
    input.delivery ?? (run.status === "RUNNING" ? "follow_up" : "prompt");
  const item: FollowUp = {
    id: crypto.randomUUID(),
    runId,
    text: input.text,
    images: input.images,
    delivery,
    status: "queued",
    createdAt: now(),
    deliveredAt: null,
  };
  followUps.get(runId)?.push(item);
  inbound.get(runId)?.push({
    type: delivery,
    text: input.text,
    images: input.images,
  });
  publish(
    event(runId, "followup.queued", "Follow-up queued", {
      data: { followUpId: item.id, delivery },
    }),
  );
  return item;
}

export function listFollowUps(runId: string): FollowUp[] {
  return followUps.get(runId) ?? [];
}

export function takeInbound(runId: string): WorkerInbound[] {
  const queued = inbound.get(runId) ?? [];
  inbound.set(runId, []);
  return queued;
}

export function archiveRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  run.status = "ARCHIVED";
  run.updatedAt = now();
  inbound.get(runId)?.push({ type: "shutdown", reason: "archived" });
  publish(event(runId, "run.archived", "Run archived"));
  return run;
}

export function abortRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  inbound.get(runId)?.push({ type: "abort" });
  run.updatedAt = now();
  return run;
}
