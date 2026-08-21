import type {
  CreateFollowUpRequest,
  CreateRunRequest,
  FollowUp,
  FollowUpDelivery,
  Run,
  RunEvent,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { publish } from "../events/bus.js";
import { DockerRuntime } from "../runtime/docker.js";
import { spawnLocalWorker, stopLocalWorker, workspaceFor } from "../worker-spawn.js";

const runs = new Map<string, Run>();
const followUps = new Map<string, FollowUp[]>();
const inbound = new Map<string, WorkerInbound[]>();
const runJwts = new Map<string, string>();
const runtime = new DockerRuntime();

function now(): string {
  return new Date().toISOString();
}

export function event(runId: string, kind: RunEvent["kind"], title: string, extra?: Partial<RunEvent>): RunEvent {
  return {
    id: extra?.id ?? crypto.randomUUID(),
    runId,
    createdAt: extra?.createdAt ?? now(),
    category:
      extra?.category ??
      (kind.startsWith("run.install") || kind.startsWith("run.") ? "agent_setup" : "agent_run"),
    level: extra?.level ?? (kind === "run.error" ? "error" : "info"),
    kind,
    title,
    detail: extra?.detail,
    data: extra?.data,
  };
}

export function mintJwtForRun(run: Run): string {
  const config = getConfig();
  const token = mintRunToken(config.jwtSecret, {
    sub: run.userId,
    runId: run.id,
    orgId: run.orgId,
    model: run.model,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    jti: crypto.randomUUID(),
  });
  runJwts.set(run.id, token);
  return token;
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
  const config = getConfig();
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
  mintJwtForRun(run);

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
  publish(event(run.id, "run.running", config.spawnLocalWorker ? "Spawning local worker" : "Worker handle reserved"));

  if (config.spawnLocalWorker) {
    const child = spawnLocalWorker(run, runJwts.get(run.id) ?? mintJwtForRun(run));
    child.once("exit", (code) => {
      const current = runs.get(run.id);
      if (!current || current.status === "ARCHIVED" || current.status === "EXPIRED") {
        return;
      }
      if (code !== 0 && current.status === "RUNNING") {
        current.status = "ERROR";
        current.errorMessage = `worker exited with code ${code}`;
        current.updatedAt = now();
        publish(event(run.id, "run.error", current.errorMessage));
      }
    });
  }
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function listRuns(): Run[] {
  return [...runs.values()];
}

export function getBootstrap(runId: string) {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  const config = getConfig();
  return {
    run,
    jwt: runJwts.get(runId) ?? mintJwtForRun(run),
    llmGatewayUrl: config.llmGatewayUrl,
    workspaceDir: workspaceFor(runId),
  };
}

export function ingestEvents(runId: string, events: RunEvent[]): void {
  if (!runs.has(runId)) {
    throw new Error(`run not found: ${runId}`);
  }
  for (const item of events) {
    publish(event(runId, item.kind, item.title, item));
    if (item.kind === "agent.end") {
      const run = runs.get(runId);
      if (run && run.status === "RUNNING") {
        run.status = "IDLE";
        run.idleAt = now();
        run.updatedAt = now();
        publish(event(runId, "run.idle", "Agent turn finished"));
      }
    }
    if (item.kind === "agent.start") {
      const run = runs.get(runId);
      if (run) {
        run.status = "RUNNING";
        run.idleAt = null;
        run.updatedAt = now();
      }
    }
  }
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
  const deliveredAt = now();
  for (const item of followUps.get(runId) ?? []) {
    if (item.status === "queued") {
      item.status = "delivered";
      item.deliveredAt = deliveredAt;
    }
  }
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
  stopLocalWorker(runId);
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
