import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CreateCommitRequest,
  CreateFollowUpRequest,
  CreateGitTokenRequest,
  CreatePullRequestRequest,
  CreateRunRequest,
  CreateSubscriptionRequest,
  DeskAssignment,
  DeskLeaseResponse,
  DiskCloneMethod,
  EgressPolicy,
  ExecutionTarget,
  FollowUp,
  FollowUpDelivery,
  HandoffRequest,
  Run,
  RunDiagnostics,
  RunEvent,
  RunSubscription,
  RuntimeHandle,
  RuntimeSpec,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import {
  assertColocatedTarget,
  evaluateEgress,
  isDeskTarget,
  MAX_SUBSCRIPTION_WAKES,
  mintRunToken,
  parseContextUsage,
  parseExecutionTarget,
  parseSubscriptionEvents,
  redactText,
  SUBSCRIPTION_COALESCE_MS,
  subscriptionKindForEvent,
  formatProjectMemory,
  subscriptionTargetsFrom,
} from "@neo-cloud-agent/contracts";
import { defaultWorkerResources, getConfig } from "../config.js";
import {
  canRestoreBuild,
  captureWorkspaceBuild,
  findActiveBuild,
  getBuild,
  restoreBuildSnapshot,
} from "../env/builds.js";
import { environmentFingerprint } from "../env/fingerprint.js";
import { findInstallTargets, runInstallCommand } from "../env/install.js";
import { readWorkspaceLogTails } from "../env/logs.js";
import { getEnvironment } from "../env/store.js";
import { claimWarmSlot, refillWarmPool } from "../env/warm-pool.js";
import { resolveEgressPolicy } from "../egress/resolve.js";
import { dropHistory, eventsForRun, publish, resetHistory, seedEvents } from "../events/bus.js";
import { keepHotHistory } from "../events/history.js";
import { restoreArchivedArtifacts, scheduleArchive } from "../objects/archive.js";
import { getRuntime } from "../runtime/factory.js";
import { persistRunWorkspace } from "../runtime/persist-workspace.js";
import { commitRunWorkspace, diffRunWorkspace, issueRunGitToken, openRunPullRequest, prepareRunRepos } from "../scm/scm.js";
import { materializeRepos, repoName } from "../scm/workspace.js";
import { controlPlaneSecrets, rememberSecret } from "../security/secrets.js";
import {
  listSessionFiles,
  loadPersistedEvents,
  loadPersistedRun,
  loadPersistedRuns,
  loadSessionFiles,
  deleteWorkerLease,
  loadWorkerLease,
  persistRunRecord,
  persistSessionFiles,
  persistWorkerLease,
  replacePersistedEvents,
  restoreSessionToDir,
  type ActiveTurn,
} from "../store/persist.js";
import { parseGitHubWebhook, subscriptionMatchesIngress } from "../subscriptions/github.js";
import { publicGitHubWebhookInfo, readGitHubWebhookSecret, verifyGitHubSignature } from "../subscriptions/secret.js";
import { hostWorkspaceFor, repoRoot, workspaceFor } from "../worker-spawn.js";
import { getProject, projectHasMember, recordProjectEvent } from "../projects/store.js";
import {
  getDesk,
  isDeskOnline,
  offerDeskAssignment,
  touchDesk,
  waitDeskAssignment,
} from "../desks/store.js";

const runs = new Map<string, Run>();
const followUps = new Map<string, FollowUp[]>();
const inbound = new Map<string, WorkerInbound[]>();
const subscriptions = new Map<string, RunSubscription[]>();
const runJwts = new Map<string, string>();
const handles = new Map<string, RuntimeHandle>();
const heartbeats = new Map<string, number>();
const runEgress = new Map<string, EgressPolicy>();
const releasingIdle = new Set<string>();
const activeTurns = new Map<string, ActiveTurn>();
const deskWorkspaces = new Map<string, string>();
let startingQueued = false;
let leaseWatch: ReturnType<typeof setInterval> | null = null;

const LIVE_STATUSES = new Set<Run["status"]>([
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

function now(): string {
  return new Date().toISOString();
}

function flushRun(runId: string): void {
  const run = runs.get(runId);
  if (!run) {
    return;
  }
  persistRunRecord({
    version: 1,
    run,
    followUps: followUps.get(runId) ?? [],
    inbound: inbound.get(runId) ?? [],
    subscriptions: subscriptions.get(runId) ?? [],
    activeTurn: activeTurns.get(runId) ?? null,
  });
}

function failRun(run: Run, message: string, kind: RunEvent["kind"] = "run.error", title = message): void {
  run.status = "ERROR";
  run.errorMessage = message;
  run.updatedAt = now();
  if (kind !== "run.error") {
    publish(event(run.id, kind, title, { level: "error", detail: message }));
  }
  publish(event(run.id, "run.error", message));
  flushRun(run.id);
  void import("../notify/dispatch.js")
    .then(({ notifyRunFinished }) => notifyRunFinished(run, "error"))
    .catch(() => undefined);
}

function hydrateRecord(record: {
  run: Run;
  followUps?: FollowUp[];
  inbound?: WorkerInbound[];
  subscriptions?: RunSubscription[];
  activeTurn?: ActiveTurn | null;
}): void {
  const run = record.run;
  run.pullRequests = Array.isArray(run.pullRequests) ? run.pullRequests : [];
  run.baseBranch = run.baseBranch ?? null;
  run.executionTarget = run.executionTarget ?? null;
  runs.set(run.id, run);
  followUps.set(run.id, record.followUps ?? []);
  inbound.set(run.id, record.inbound ?? []);
  subscriptions.set(run.id, record.subscriptions ?? []);
  if (record.activeTurn?.text) {
    activeTurns.set(run.id, record.activeTurn);
  } else {
    activeTurns.delete(run.id);
  }
  if (keepHotHistory(run.status)) {
    seedEvents(run.id, loadPersistedEvents(run.id));
  }
}

function hydrateFromDisk(): void {
  for (const record of loadPersistedRuns()) {
    hydrateRecord(record);
  }
}

export function reloadPersistedState(): void {
  runs.clear();
  followUps.clear();
  inbound.clear();
  subscriptions.clear();
  runJwts.clear();
  handles.clear();
  heartbeats.clear();
  runEgress.clear();
  releasingIdle.clear();
  activeTurns.clear();
  deskWorkspaces.clear();
  startingQueued = false;
  resetHistory();
  hydrateFromDisk();
}

export function workerHeartbeatTimeoutMs(): number {
  return Number(process.env.WORKER_HEARTBEAT_TIMEOUT_MS ?? 20_000);
}

export function noteWorkerHeartbeat(runId: string, at = Date.now()): void {
  heartbeats.set(runId, at);
}

export function isWorkerAttached(runId: string, at = Date.now()): boolean {
  if (handles.has(runId)) {
    return true;
  }
  const seen = heartbeats.get(runId);
  return seen !== undefined && at - seen < workerHeartbeatTimeoutMs();
}

function hasPendingUserInbound(runId: string): boolean {
  return (inbound.get(runId) ?? []).some((item) => item.type === "prompt" || item.type === "steer" || item.type === "follow_up");
}

function asActiveTurn(item: WorkerInbound): ActiveTurn | null {
  if (item.type !== "prompt" && item.type !== "steer" && item.type !== "follow_up") {
    return null;
  }
  return { type: item.type, text: item.text, images: item.images };
}

function rememberActiveTurns(runId: string, queued: WorkerInbound[]): void {
  for (let index = queued.length - 1; index >= 0; index -= 1) {
    const active = asActiveTurn(queued[index] ?? { type: "abort" });
    if (active) {
      activeTurns.set(runId, active);
      return;
    }
  }
}

function clearActiveTurn(runId: string): void {
  activeTurns.delete(runId);
}

function requeueActiveTurn(run: Run): boolean {
  if (hasPendingUserInbound(run.id)) {
    return true;
  }
  const active = activeTurns.get(run.id);
  if (!active) {
    return false;
  }
  inbound.get(run.id)?.push({ type: active.type, text: active.text, images: active.images });
  publish(
    event(run.id, "followup.queued", "中断的回合已自动排队继续", {
      data: { resume: true, delivery: active.type },
    }),
  );
  return true;
}

function settleDetachedRun(run: Run, title: string): void {
  run.status = "IDLE";
  run.errorMessage = null;
  run.workerHandle = null;
  run.vmSlotId = null;
  run.idleAt = now();
  run.updatedAt = now();
  handles.delete(run.id);
  deleteWorkerLease(run.id);
  heartbeats.delete(run.id);
  publish(event(run.id, "run.idle", title));
  flushRun(run.id);
}

function detachOrQueue(run: Run, queuedTitle: string, idleTitle: string): void {
  const resumed = requeueActiveTurn(run);
  if (isDeskTarget(run.executionTarget)) {
    offerDeskAssignment(run.executionTarget.deskId ?? "", run.id);
  }
  if (hasPendingUserInbound(run.id)) {
    queueRun(run, resumed ? "中断的回合已自动排队，空出来会继续" : queuedTitle);
    return;
  }
  settleDetachedRun(run, idleTitle);
}

function bindWorkerExit(runId: string) {
  return (code: number | null) => {
    const current = runs.get(runId);
    if (!current || current.status === "ARCHIVED" || current.status === "EXPIRED") {
      return;
    }
    handles.delete(runId);
    deleteWorkerLease(runId);
    heartbeats.delete(runId);
    if (releasingIdle.has(runId) || current.status === "IDLE") {
      current.workerHandle = null;
      current.vmSlotId = null;
      current.updatedAt = now();
      flushRun(runId);
      void tryStartQueued();
      return;
    }
    if (code !== 0 && current.status === "RUNNING") {
      current.status = "ERROR";
      current.errorMessage = `worker exited with code ${code}`;
      current.updatedAt = now();
      publish(event(runId, "run.error", current.errorMessage));
      flushRun(runId);
    }
    void tryStartQueued();
  };
}

export async function recoverLiveWorkers(): Promise<void> {
  for (const run of runs.values()) {
    if (run.status === "ERROR" && /heartbeat lost after control plane restart/i.test(run.errorMessage ?? "")) {
      detachOrQueue(run, "控制面重启后正在排队等待空闲电脑", "控制面已恢复，发送即可继续");
      continue;
    }
    if (!LIVE_STATUSES.has(run.status) || handles.has(run.id)) {
      continue;
    }
    const lease = loadWorkerLease(run.id);
    try {
      const runtime = lease?.runtime === "desk" ? getRuntime("desk") : getRuntime();
      const handle = await runtime.adopt(run.id, lease, { onExit: bindWorkerExit(run.id) });
      if (handle) {
        handles.set(run.id, handle);
        run.workerHandle = handle.id;
        run.errorMessage = null;
        run.updatedAt = now();
        noteWorkerHeartbeat(run.id);
        persistWorkerLease({
          runId: run.id,
          runtime: handle.runtime,
          handleId: handle.id,
          pid: handle.pid ?? lease?.pid ?? null,
          container: handle.runtime === "docker" ? handle.id : null,
          socket: handle.socket ?? lease?.socket ?? null,
          cid: handle.cid ?? lease?.cid ?? null,
          updatedAt: now(),
        });
        publish(event(run.id, "run.running", "Reattached existing worker"));
        flushRun(run.id);
        continue;
      }
    } catch (error) {
      console.error(`failed to adopt worker for ${run.id}`, error);
    }
    detachOrQueue(run, "控制面重启后正在排队等待空闲电脑", "控制面已恢复，发送即可继续");
  }
  startWorkerLeaseWatch();
  void tryStartQueued();
}

export function expireStaleWorkers(at = Date.now()): string[] {
  const expired: string[] = [];
  const timeout = workerHeartbeatTimeoutMs();
  for (const run of runs.values()) {
    if (!LIVE_STATUSES.has(run.status) || run.status === "NOT_YET_STARTED") {
      continue;
    }
    if (handles.has(run.id)) {
      // Process/container liveness is owned by the runtime. Heartbeats only
      // cover the post-restart gap when adopt() could not reattach.
      continue;
    }
    const lastSeen = heartbeats.get(run.id) ?? Date.parse(run.updatedAt);
    if (Number.isFinite(lastSeen) && at - lastSeen < timeout) {
      continue;
    }
    detachOrQueue(run, "工作进程已断开，正在排队等待空闲电脑", "控制面重启后连接已断开，发送即可继续");
    expired.push(run.id);
  }
  if (expired.length > 0) {
    void tryStartQueued();
  }
  return expired;
}

export function workerIdleReleaseMs(): number {
  const raw = process.env.WORKER_IDLE_RELEASE_MS;
  if (raw === "0") {
    return 0;
  }
  const n = Number(raw ?? 15 * 60_000);
  return Number.isFinite(n) && n >= 0 ? n : 15 * 60_000;
}

function isSlotBusyError(error: unknown): boolean {
  return error instanceof Error && /all VM slots are busy/i.test(error.message);
}

function queueRun(run: Run, title = "两台云端电脑都在忙，已排队，空出来会自动开始"): void {
  run.status = "NOT_YET_STARTED";
  run.errorMessage = null;
  run.workerHandle = null;
  run.vmSlotId = null;
  run.updatedAt = now();
  handles.delete(run.id);
  deleteWorkerLease(run.id);
  heartbeats.delete(run.id);
  publish(event(run.id, "run.queued", title));
  flushRun(run.id);
}

export async function tryStartQueued(): Promise<string | null> {
  if (startingQueued) {
    return null;
  }
  startingQueued = true;
  try {
    const waiting = [...runs.values()]
      .filter(
        (run) =>
          !isDeskTarget(run.executionTarget) &&
          !handles.has(run.id) &&
          (run.status === "NOT_YET_STARTED" ||
            ((run.status === "IDLE" || run.status === "ERROR") && hasPendingUserInbound(run.id))),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let started: string | null = null;
    for (const run of waiting) {
      try {
        run.status = "PROVISIONING";
        run.updatedAt = now();
        publish(event(run.id, "run.provisioning", runningTitle()));
        flushRun(run.id);
        await attachWorker(run, runningTitle());
        started = run.id;
      } catch (error) {
        if (isSlotBusyError(error)) {
          queueRun(run);
          break;
        }
        const message = error instanceof Error ? error.message : "worker provision failed";
        failRun(run, message);
      }
    }
    return started;
  } finally {
    startingQueued = false;
  }
}

export async function releaseIdleWorker(runId: string): Promise<boolean> {
  const run = runs.get(runId);
  if (!run || run.status !== "IDLE" || !handles.has(runId)) {
    return false;
  }
  const pending = inbound.get(runId) ?? [];
  if (pending.some((item) => item.type !== "shutdown")) {
    return false;
  }
  releasingIdle.add(runId);
  try {
    await persistRunWorkspace(runId).catch((error) => {
      console.error(`failed to persist idle workspace for ${runId}`, error);
    });
    inbound.get(runId)?.push({ type: "shutdown", reason: "idle" });
    const handle = handles.get(runId);
    if (handle) {
      await getRuntime().destroy(handle);
    }
    handles.delete(runId);
    deleteWorkerLease(runId);
    heartbeats.delete(runId);
    run.workerHandle = null;
    run.vmSlotId = null;
    run.updatedAt = now();
    publish(event(runId, "run.idle", "Released idle VM slot"));
    flushRun(runId);
  } finally {
    releasingIdle.delete(runId);
  }
  const leftover = inbound.get(runId) ?? [];
  if (leftover.some((item) => item.type !== "shutdown")) {
    try {
      await resumeRun(runId);
    } catch (error) {
      if (isSlotBusyError(error)) {
        queueRun(run);
      }
    }
  } else {
    await tryStartQueued();
  }
  return true;
}

export async function expireIdleWorkers(at = Date.now()): Promise<string[]> {
  const ttl = workerIdleReleaseMs();
  if (ttl === 0) {
    return [];
  }
  const released: string[] = [];
  for (const run of runs.values()) {
    if (run.status !== "IDLE" || !handles.has(run.id) || !run.idleAt) {
      continue;
    }
    const idleAt = Date.parse(run.idleAt);
    if (!Number.isFinite(idleAt) || at - idleAt < ttl) {
      continue;
    }
    if (await releaseIdleWorker(run.id)) {
      released.push(run.id);
    }
  }
  return released;
}

export function startWorkerLeaseWatch(): void {
  if (leaseWatch) {
    return;
  }
  leaseWatch = setInterval(() => {
    expireStaleWorkers();
    void expireIdleWorkers();
  }, 2000);
  leaseWatch.unref();
}

export function event(runId: string, kind: RunEvent["kind"], title: string, extra?: Partial<RunEvent>): RunEvent {
  return {
    id: extra?.id ?? crypto.randomUUID(),
    runId,
    createdAt: extra?.createdAt ?? now(),
    category:
      extra?.category ??
      (kind.startsWith("build.")
        ? "build"
        : kind.startsWith("run.") || kind.startsWith("scm.") || kind.startsWith("subscription.")
          ? "agent_setup"
          : "agent_run"),
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
  rememberSecret(token);
  return token;
}

function workerCommand(): string[] | undefined {
  const raw = process.env.WORKER_COMMAND;
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // fall through to whitespace split
  }
  return raw.split(/\s+/).filter(Boolean);
}

function egressForRun(run: Run): EgressPolicy {
  const existing = runEgress.get(run.id);
  if (existing) {
    return existing;
  }
  const policy = resolveEgressPolicy({
    workspaceDir: workspaceFor(run.id),
    env: run.envId ? getEnvironment(run.envId) : undefined,
  });
  runEgress.set(run.id, policy);
  return policy;
}

function rememberEgress(run: Run, workspaceDir?: string): EgressPolicy {
  const policy = resolveEgressPolicy({
    workspaceDir,
    env: run.envId ? getEnvironment(run.envId) : undefined,
  });
  runEgress.set(run.id, policy);
  return policy;
}

function denyEgress(run: Run, policy: EgressPolicy, target: string): boolean {
  const decision = evaluateEgress(policy, target);
  if (decision.allow) {
    return false;
  }
  publish(
    event(run.id, "egress.denied", `Blocked outbound host ${decision.host}`, {
      level: "error",
      data: { host: decision.host, mode: policy.mode, target },
    }),
  );
  failRun(run, decision.reason);
  return true;
}

function launchSpec(run: Run, jwt: string): RuntimeSpec {
  const config = getConfig();
  const egress = egressForRun(run);
  const resources = defaultWorkerResources(config.workerRuntime);
  return {
    runId: run.id,
    image: config.workerImage,
    snapshotId: run.buildId ? `snap_${run.buildId}` : null,
    cpu: resources.cpu,
    memoryMiB: resources.memoryMiB,
    diskGiB: resources.diskGiB,
    egress: { mode: egress.mode, domains: egress.domains ?? [] },
    jwt,
    model: run.model,
    hostWorkspaceDir: workspaceFor(run.id),
    hostWorkspaceBind: hostWorkspaceFor(run.id),
    workspaceMount: config.workerWorkspaceMount,
    controlPlaneUrl: config.workerControlPlaneUrl,
    llmGatewayUrl: config.workerLlmGatewayUrl,
    dockerNetwork: config.dockerNetwork,
    command: workerCommand(),
  };
}

function runningTitle(): string {
  const kind = getConfig().workerRuntime;
  if (kind === "local") return "Spawning local worker";
  if (kind === "docker") return "Starting Docker worker";
  if (kind === "firecracker") return "Starting Firecracker microVM";
  if (kind === "vm") return "Mounting VM slot";
  return "Worker handle reserved";
}

function writeProjectMemory(run: Run): void {
  if (!run.projectId) return;
  const project = getProject(run.projectId);
  if (!project) return;
  const dest = path.join(workspaceFor(run.id), ".neo");
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "PROJECT.md"), formatProjectMemory(project));
}

export async function createRun(input: CreateRunRequest, owner?: { userId?: string; orgId?: string }): Promise<Run> {
  const config = getConfig();
  const createdAt = now();
  let repoUrls = input.repoUrls;
  let projectId: string | null = null;
  if (input.projectId) {
    const project = getProject(input.projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    if (owner?.userId && !projectHasMember(project.id, owner.userId)) {
      throw new Error("不是项目成员");
    }
    projectId = project.id;
    if (repoUrls.length === 0 && project.defaultRepoUrls.length > 0) {
      repoUrls = [...project.defaultRepoUrls];
    }
  }
  const target = parseExecutionTarget(input.target);
  if (target) {
    assertColocatedTarget(target);
  }
  if (isDeskTarget(target)) {
    const desk = getDesk(target.deskId ?? "");
    if (!desk) {
      throw new Error("本机未登记");
    }
    if (owner?.userId && desk.userId !== owner.userId) {
      throw new Error("不是这台本机的主人");
    }
    if (!isDeskOnline(desk)) {
      throw new Error("本机未在线");
    }
  }
  const run: Run = {
    id: crypto.randomUUID(),
    orgId: owner?.orgId ?? config.orgId,
    userId: owner?.userId ?? config.userId,
    projectId,
    assigneeUserId: owner?.userId ?? config.userId,
    envId: input.envId ?? null,
    envVersionId: null,
    buildId: null,
    status: "PROVISIONING",
    setupStatus: null,
    source: input.source ?? (isDeskTarget(target) ? "desk" : "api"),
    executionTarget: target ?? { loop: "cloud", tools: "cloud" },
    model: input.model ?? config.defaultModel,
    prompt: input.prompt,
    branchName: null,
    baseBranch: null,
    repoUrls,
    pullRequests: [],
    workerHandle: null,
    vmSlotId: null,
    createdAt,
    updatedAt: createdAt,
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
    usage: null,
  };
  runs.set(run.id, run);
  followUps.set(run.id, []);
  inbound.set(run.id, [{ type: "prompt", text: input.prompt, images: input.images }]);
  subscriptions.set(run.id, []);
  publish(event(run.id, "run.provisioning", "Provisioning worker"));
  publish(
    event(run.id, "user.message", "User message", {
      category: "agent_run",
      data: { text: input.prompt, source: run.source, images: input.images },
    }),
  );
  mintJwtForRun(run);
  flushRun(run.id);

  if (isDeskTarget(run.executionTarget)) {
    offerDeskAssignment(run.executionTarget.deskId ?? "", run.id);
    queueRun(run, "等待本机 Desk 认领");
    return run;
  }

  const fingerprint = environmentFingerprint({ repoUrls: run.repoUrls, ref: input.ref ?? null });
  let restoredFromBuild = false;
  const policy = rememberEgress(run);
  for (const url of run.repoUrls) {
    if (denyEgress(run, policy, url)) {
      return run;
    }
  }

  try {
    if (run.repoUrls.length > 0) {
      const existing =
        input.reuseBuild === false
          ? undefined
          : input.buildId
            ? getBuild(input.buildId)
            : findActiveBuild(fingerprint);
      if (canRestoreBuild(existing)) {
        publish(
          event(run.id, "scm.clone_started", "Restoring environment snapshot", {
            data: { repoUrls: run.repoUrls, buildId: existing.id },
          }),
        );
        const dest = workspaceFor(run.id);
        const fromWarm = await claimWarmSlot(existing.id, dest);
        let cloneMethod: DiskCloneMethod = "rename";
        if (!fromWarm) {
          cloneMethod = (await restoreBuildSnapshot(existing, dest)).method;
        } else if (existing.snapshotPath) {
          void refillWarmPool(existing.id, existing.snapshotPath).catch((error) =>
            console.error("warm pool refill failed", error),
          );
        }
        run.buildId = existing.id;
        run.envId = run.envId ?? existing.envId;
        run.envVersionId = existing.envVersionId;
        run.setupStatus = "INSTALL_SUCCEEDED";
        run.updatedAt = now();
        restoredFromBuild = true;
        publish(
          event(run.id, "scm.clone_succeeded", fromWarm ? "Warm pool workspace ready" : "Workspace restored from build", {
            data: { buildId: existing.id, warm: fromWarm, cloneMethod },
          }),
        );
        publish(
          event(run.id, "build.used", "Using environment build snapshot", {
            category: "build",
            data: { buildId: existing.id, fingerprint, warm: fromWarm, cloneMethod },
          }),
        );
        flushRun(run.id);
      } else {
        publish(
          event(run.id, "scm.clone_started", "Preparing workspace", {
            data: { repoUrls: run.repoUrls },
          }),
        );
        const placed = await materializeRepos(run.repoUrls, workspaceFor(run.id), repoRoot());
        publish(
          event(run.id, "scm.clone_succeeded", "Workspace ready", {
            data: {
              dests: placed.map((item) => ({ name: item.ref.name, kind: item.ref.kind, source: item.ref.raw })),
            },
          }),
        );
        flushRun(run.id);
      }
      rememberEgress(run, workspaceFor(run.id));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace prepare failed";
    failRun(run, message, "scm.clone_failed", "Workspace prepare failed");
    return run;
  }

  if (!restoredFromBuild) {
    try {
      const targets = findInstallTargets(workspaceFor(run.id));
      if (targets.length > 0) {
        run.status = "INSTALLING";
        run.setupStatus = "INSTALL_STARTED";
        run.updatedAt = now();
        publish(
          event(run.id, "run.install_started", "Running environment install", {
            data: { files: targets.map((item) => item.file) },
          }),
        );
        flushRun(run.id);
        for (const target of targets) {
          const result = await runInstallCommand(target.cwd, target.command);
          if (result.code !== 0) {
            const message = (result.stderr || result.stdout || `install exited ${result.code}`).trim().slice(-4000);
            run.setupStatus = "INSTALL_FAILED";
            failRun(run, message || `install exited ${result.code}`, "run.install_failed", "Environment install failed");
            return run;
          }
        }
        run.setupStatus = "INSTALL_SUCCEEDED";
        run.updatedAt = now();
        publish(event(run.id, "run.install_succeeded", "Environment install finished"));
        flushRun(run.id);
      }
      if (run.repoUrls.length > 0 && run.status !== "ERROR") {
        const captured = await captureWorkspaceBuild({
          workspaceDir: workspaceFor(run.id),
          repoUrls: run.repoUrls,
          ref: input.ref ?? null,
          envId: run.envId,
          source: "agent",
        });
        if (captured?.status === "SUCCEEDED") {
          run.buildId = captured.id;
          run.envId = run.envId ?? captured.envId;
          run.envVersionId = captured.envVersionId;
          flushRun(run.id);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "environment install failed";
      run.setupStatus = "INSTALL_FAILED";
      failRun(run, message, "run.install_failed", "Environment install failed");
      return run;
    }
  }

  try {
    if (run.repoUrls.length > 0) {
      const dests =
        run.repoUrls.length <= 1
          ? [workspaceFor(run.id)]
          : run.repoUrls.map((url) => path.join(workspaceFor(run.id), repoName(url)));
      const prepared = await prepareRunRepos(dests, run);
      const first = prepared[0];
      if (first) {
        run.branchName = first.branch;
        run.baseBranch = first.baseBranch;
        run.updatedAt = now();
        publish(
          event(run.id, "scm.branch_created", `Created branch ${first.branch}`, {
            data: { branch: first.branch, baseBranch: first.baseBranch },
          }),
        );
        flushRun(run.id);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "git branch failed";
    failRun(run, message, "scm.branch_failed", "Failed to create run branch");
    return run;
  }

  try {
    writeProjectMemory(run);
    await attachWorker(run, runningTitle());
  } catch (error) {
    if (isSlotBusyError(error)) {
      queueRun(run);
      return run;
    }
    const message = error instanceof Error ? error.message : "worker provision failed";
    failRun(run, message);
    return run;
  }
  return run;
}

async function attachWorker(run: Run, title: string): Promise<void> {
  const handle = await getRuntime().provision(launchSpec(run, runJwts.get(run.id) ?? mintJwtForRun(run)), {
    onExit: bindWorkerExit(run.id),
  });
  handles.set(run.id, handle);
  run.workerHandle = handle.id;
  run.vmSlotId = handle.slotId ?? run.vmSlotId ?? null;
  run.status = "RUNNING";
  run.errorMessage = null;
  run.updatedAt = now();
  noteWorkerHeartbeat(run.id);
  persistWorkerLease({
    runId: run.id,
    runtime: handle.runtime,
    handleId: handle.id,
    pid: handle.pid ?? null,
    container: handle.runtime === "docker" ? handle.id : null,
    socket: handle.socket ?? null,
    cid: handle.cid ?? null,
    updatedAt: now(),
  });
  publish(event(run.id, "run.running", title));
  flushRun(run.id);
}

export async function resumeRun(runId: string): Promise<Run> {
  const run = requireRun(runId);
  if (isWorkerAttached(runId)) {
    return run;
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  if (isDeskTarget(run.executionTarget)) {
    offerDeskAssignment(run.executionTarget.deskId ?? "", run.id);
    queueRun(run, "等待本机 Desk 认领");
    return run;
  }
  restoreSessionToDir(runId, path.join(workspaceFor(runId), "sessions"));
  run.status = "PROVISIONING";
  run.updatedAt = now();
  publish(event(runId, "run.provisioning", "Resuming worker from session backup"));
  flushRun(runId);
  try {
    await attachWorker(run, "Resuming worker");
  } catch (error) {
    if (isSlotBusyError(error)) {
      run.status = "IDLE";
      run.errorMessage = null;
      run.workerHandle = null;
      run.vmSlotId = null;
      run.updatedAt = now();
      publish(event(run.id, "run.queued", "两台云端电脑都在忙，已排队，空出来会自动开始"));
      flushRun(run.id);
      return run;
    }
    const message = error instanceof Error ? error.message : "worker provision failed";
    failRun(run, message);
    throw error;
  }
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function adoptRun(runId: string, userId: string, orgId?: string): Run | undefined {
  const run = runs.get(runId);
  if (!run || !userId) {
    return undefined;
  }
  run.userId = userId;
  run.assigneeUserId = userId;
  if (orgId) {
    run.orgId = orgId;
  }
  run.updatedAt = now();
  flushRun(runId);
  return run;
}

export async function loadRunIntoMemory(runId: string): Promise<Run | undefined> {
  const existing = runs.get(runId);
  if (existing) {
    return existing;
  }
  const local = loadPersistedRun(runId);
  if (local?.run?.id) {
    hydrateRecord(local);
    return local.run;
  }
  try {
    const { getPostgresStore } = await import("../platform.js");
    const store = getPostgresStore();
    const remote = await store?.loadRun(runId);
    if (remote?.run?.id) {
      persistRunRecord(remote, undefined, { mirror: false });
      const events = (await store?.loadEvents(runId)) ?? [];
      if (events.length > 0) {
        replacePersistedEvents(runId, events);
      }
      hydrateRecord(remote);
      return remote.run;
    }
  } catch {
    // postgres is optional
  }
  return restoreArchivedRun(runId);
}

export function transferRun(
  runId: string,
  toUserId: string,
  actor: { userId: string; email: string },
  note = "",
): Run {
  const run = requireRun(runId);
  if (!run.projectId) {
    throw new Error("只有项目里的对话才能转交");
  }
  if (!projectHasMember(run.projectId, toUserId)) {
    throw new Error("对方还不是项目成员");
  }
  if (run.userId !== actor.userId && !projectHasMember(run.projectId, actor.userId)) {
    throw new Error("没有权限转交");
  }
  run.userId = toUserId;
  run.assigneeUserId = toUserId;
  run.updatedAt = now();
  flushRun(run.id);
  recordProjectEvent(run.projectId, actor, "transferred", note.trim() ? `转交了对话：${note.trim()}` : "转交了一条对话");
  return run;
}

export function listRuns(): Run[] {
  return [...runs.values()];
}

function assignmentFor(run: Run): DeskAssignment {
  const config = getConfig();
  return {
    runId: run.id,
    jwt: runJwts.get(run.id) ?? mintJwtForRun(run),
    model: run.model,
    prompt: run.prompt,
    repoUrls: run.repoUrls,
    controlPlaneUrl: config.controlPlaneUrl,
    llmGatewayUrl: config.workerLlmGatewayUrl,
    target: run.executionTarget ?? { loop: "desk", tools: "desk" },
  };
}

export async function leaseDesk(deskId: string, waitMs = 20_000): Promise<DeskLeaseResponse> {
  const desk = touchDesk(deskId);
  if (!desk) {
    throw new Error("desk not found");
  }
  const runId = await waitDeskAssignment(deskId, waitMs);
  if (!runId) {
    return { assignment: null };
  }
  const run = runs.get(runId);
  if (!run || run.status === "ARCHIVED" || run.status === "EXPIRED") {
    return { assignment: null };
  }
  return { assignment: assignmentFor(run) };
}

export async function claimDeskRun(
  deskId: string,
  input: { runId: string; workspaceDir: string; pid?: number },
): Promise<Run> {
  const run = requireRun(input.runId);
  if (!isDeskTarget(run.executionTarget) || run.executionTarget?.deskId !== deskId) {
    throw new Error("run is not assigned to this desk");
  }
  const workspaceDir = input.workspaceDir.trim();
  if (!workspaceDir) {
    throw new Error("workspaceDir is required");
  }
  deskWorkspaces.set(run.id, workspaceDir);
  touchDesk(deskId);
  const handle =
    (await getRuntime("desk").adopt(
      run.id,
      {
        runId: run.id,
        runtime: "desk",
        handleId: `desk-${run.id}`,
        pid: input.pid ?? null,
        updatedAt: now(),
      },
      { onExit: bindWorkerExit(run.id) },
    )) ?? { id: `desk-${run.id}`, runtime: "desk" as const, ip: null, pid: input.pid ?? null };
  handles.set(run.id, handle);
  run.workerHandle = handle.id;
  run.status = "RUNNING";
  run.errorMessage = null;
  run.updatedAt = now();
  noteWorkerHeartbeat(run.id);
  persistWorkerLease({
    runId: run.id,
    runtime: "desk",
    handleId: handle.id,
    pid: handle.pid ?? input.pid ?? null,
    container: null,
    socket: null,
    cid: null,
    updatedAt: now(),
  });
  publish(event(run.id, "run.running", "Desk worker claimed this run"));
  flushRun(run.id);
  return run;
}

function looksRemoteRepo(url: string): boolean {
  return /^(https?:\/\/|git@|github\.com\/)/i.test(url);
}

export async function handoffRun(runId: string, input: HandoffRequest): Promise<Run> {
  const run = requireRun(runId);
  const target = parseExecutionTarget(input.target);
  if (!target) {
    throw new Error("invalid execution target");
  }
  assertColocatedTarget(target);
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  const handle = handles.get(runId);
  if (handle) {
    inbound.get(runId)?.push({ type: "shutdown", reason: "idle" });
    await getRuntime(handle.runtime === "desk" ? "desk" : undefined).destroy(handle);
    handles.delete(runId);
    deleteWorkerLease(runId);
    heartbeats.delete(runId);
    run.workerHandle = null;
    run.vmSlotId = null;
  }
  run.executionTarget = target;
  run.updatedAt = now();
  if (isDeskTarget(target)) {
    const desk = getDesk(target.deskId ?? "");
    if (!desk) {
      throw new Error("本机未登记");
    }
    if (!isDeskOnline(desk)) {
      throw new Error("本机未在线");
    }
    offerDeskAssignment(target.deskId ?? "", run.id);
    queueRun(run, "已交给本机，等待 Desk 认领");
    return run;
  }
  if (!run.repoUrls.some(looksRemoteRepo)) {
    throw new Error("切到云端需要可 clone 的远端仓库。未提交的改动不会带过去。");
  }
  restoreSessionToDir(runId, path.join(workspaceFor(runId), "sessions"));
  const remotes = run.repoUrls.filter(looksRemoteRepo);
  publish(
    event(run.id, "scm.clone_started", "Handoff: cloning clean remote", {
      data: { repoUrls: remotes },
    }),
  );
  await materializeRepos(remotes, workspaceFor(run.id), repoRoot());
  publish(event(run.id, "scm.clone_succeeded", "Handoff workspace ready"));
  await attachWorker(run, "Handed off to cloud worker");
  return run;
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
    llmGatewayUrl: config.workerLlmGatewayUrl,
    workspaceDir: isDeskTarget(run.executionTarget)
      ? (deskWorkspaces.get(runId) ?? "")
      : config.workerRuntime === "docker"
        ? config.workerWorkspaceMount
        : workspaceFor(runId),
    egress: egressForRun(run),
  };
}

export function ingestEvents(runId: string, events: RunEvent[]): void {
  if (!runs.has(runId)) {
    throw new Error(`run not found: ${runId}`);
  }
  noteWorkerHeartbeat(runId);
  for (const item of events) {
    publish(event(runId, item.kind, item.title, item));
    if (item.kind === "context.usage") {
      const run = runs.get(runId);
      const parsed = parseContextUsage(item.data);
      if (run && parsed) {
        run.contextUsage = parsed;
        run.updatedAt = now();
        flushRun(runId);
      }
    }
    if (item.kind === "llm.usage") {
      const run = runs.get(runId);
      if (run) {
        const promptTokens = Number(item.data?.promptTokens ?? 0);
        const completionTokens = Number(item.data?.completionTokens ?? 0);
        const totalTokens = Number(item.data?.totalTokens ?? promptTokens + completionTokens);
        const prev = run.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        run.usage = {
          promptTokens: prev.promptTokens + (Number.isFinite(promptTokens) ? promptTokens : 0),
          completionTokens: prev.completionTokens + (Number.isFinite(completionTokens) ? completionTokens : 0),
          totalTokens: prev.totalTokens + (Number.isFinite(totalTokens) ? totalTokens : 0),
        };
        run.updatedAt = now();
        flushRun(runId);
      }
    }
    if (item.kind === "agent.end") {
      const run = runs.get(runId);
      if (run && run.status === "RUNNING") {
        clearActiveTurn(runId);
        run.status = "IDLE";
        run.idleAt = now();
        run.updatedAt = now();
        publish(event(runId, "run.idle", "Agent turn finished"));
        flushRun(runId);
        void import("../notify/dispatch.js")
          .then(({ notifyRunFinished }) => notifyRunFinished(run, "idle"))
          .catch(() => undefined);
      }
    }
    if (item.kind === "agent.start") {
      const run = runs.get(runId);
      if (run) {
        run.status = "RUNNING";
        run.idleAt = null;
        run.updatedAt = now();
        flushRun(runId);
      }
    }
    if (item.kind === "run.start_started") {
      const run = runs.get(runId);
      if (run) {
        run.setupStatus = "START_STARTED";
        run.updatedAt = now();
        flushRun(runId);
      }
    }
    if (item.kind === "run.start_succeeded") {
      const run = runs.get(runId);
      if (run) {
        run.setupStatus = "START_SUCCEEDED";
        run.updatedAt = now();
        flushRun(runId);
      }
    }
    if (item.kind === "run.start_failed") {
      const run = runs.get(runId);
      if (run) {
        run.setupStatus = "START_FAILED";
        run.updatedAt = now();
        if (item.data?.fatal === true) {
          failRun(run, item.detail || item.title || "Environment start failed");
        } else {
          flushRun(runId);
        }
      }
    }
  }
}

export async function enqueueFollowUp(runId: string, input: CreateFollowUpRequest): Promise<FollowUp> {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
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
  publish(
    event(runId, "user.message", "User message", {
      category: "agent_run",
      data: { text: input.text, followUpId: item.id, delivery, images: input.images },
    }),
  );
  flushRun(runId);
  if (!isWorkerAttached(runId)) {
    try {
      await resumeRun(runId);
    } catch {
      // follow-up stays queued; resumeRun queued or marked ERROR
    }
  }
  return item;
}

export function listFollowUps(runId: string): FollowUp[] {
  return followUps.get(runId) ?? [];
}

export function listRunSubscriptions(runId: string): RunSubscription[] {
  return subscriptions.get(runId) ?? [];
}

export function subscribeRun(
  runId: string,
  input: CreateSubscriptionRequest = {},
): { subscriptions: RunSubscription[]; created: RunSubscription[]; webhook: { path: string; configured: boolean } } {
  const run = requireRun(runId);
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  const events = parseSubscriptionEvents(input.events);
  const targets = subscriptionTargetsFrom(run);
  if (targets.length === 0) {
    throw new Error("No GitHub repository on this run. Attach a github.com repo or open a pull request first.");
  }
  const existing = subscriptions.get(runId) ?? [];
  const created: RunSubscription[] = [];
  for (const target of targets) {
    for (const item of events) {
      const kind = subscriptionKindForEvent(item);
      const found = existing.find(
        (entry) =>
          entry.kind === kind &&
          entry.repo === target.repo &&
          entry.prNumber === target.prNumber &&
          entry.branch === target.branch,
      );
      if (found) {
        created.push(found);
        continue;
      }
      const next: RunSubscription = {
        id: crypto.randomUUID(),
        runId,
        kind,
        repo: target.repo,
        prNumber: target.prNumber,
        branch: target.branch,
        createdAt: now(),
        wakeCount: 0,
        lastDeliveryKey: null,
        lastDeliveredAt: null,
      };
      existing.push(next);
      created.push(next);
      publish(
        event(runId, "subscription.created", `Subscribed to ${kind} on ${target.repo}`, {
          category: "agent_setup",
          data: {
            subscriptionId: next.id,
            kind,
            repo: target.repo,
            prNumber: target.prNumber,
            branch: target.branch,
          },
        }),
      );
    }
  }
  subscriptions.set(runId, existing);
  flushRun(runId);
  return { subscriptions: existing, created, webhook: publicGitHubWebhookInfo() };
}

export async function ingestGitHubWebhook(input: {
  eventName: string;
  deliveryId?: string;
  signature?: string | string[];
  raw: Buffer;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = readGitHubWebhookSecret();
  if (!secret) {
    return { status: 503, body: { error: "webhook_not_configured" } };
  }
  if (!verifyGitHubSignature(input.raw, secret, input.signature)) {
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let payload: unknown = {};
  if (input.raw.length > 0) {
    try {
      payload = JSON.parse(input.raw.toString("utf8")) as unknown;
    } catch {
      return { status: 400, body: { error: "invalid_json" } };
    }
  }
  const ingress = parseGitHubWebhook(input.eventName, payload, input.deliveryId);
  if (ingress.kind === "ping") {
    return { status: 200, body: { ok: true, zen: ingress.text } };
  }
  if (ingress.kind === "ignored") {
    return { status: 202, body: { ok: true, ignored: true } };
  }
  let delivered = 0;
  for (const [runId, items] of subscriptions) {
    const run = runs.get(runId);
    if (!run || run.status === "ARCHIVED" || run.status === "EXPIRED") {
      continue;
    }
    for (const item of items) {
      if (!subscriptionMatchesIngress(item, ingress)) {
        continue;
      }
      if (item.lastDeliveryKey === ingress.deliveryKey) {
        continue;
      }
      if (item.wakeCount >= MAX_SUBSCRIPTION_WAKES) {
        continue;
      }
      const lastAt = item.lastDeliveredAt ? Date.parse(item.lastDeliveredAt) : 0;
      if (lastAt && Date.now() - lastAt < SUBSCRIPTION_COALESCE_MS) {
        continue;
      }
      item.lastDeliveryKey = ingress.deliveryKey;
      item.lastDeliveredAt = now();
      item.wakeCount += 1;
      publish(
        event(runId, "subscription.delivered", "GitHub subscription event", {
          category: "agent_setup",
          data: {
            subscriptionId: item.id,
            kind: item.kind,
            repo: item.repo,
            deliveryKey: ingress.deliveryKey,
            wakeCount: item.wakeCount,
          },
        }),
      );
      await enqueueFollowUp(runId, { text: ingress.text });
      delivered += 1;
    }
  }
  flushAllSubscriptions();
  return { status: 202, body: { ok: true, delivered } };
}

function flushAllSubscriptions(): void {
  for (const runId of subscriptions.keys()) {
    if (runs.has(runId)) {
      flushRun(runId);
    }
  }
}

export function takeInbound(runId: string): WorkerInbound[] {
  noteWorkerHeartbeat(runId);
  const queued = inbound.get(runId) ?? [];
  inbound.set(runId, []);
  rememberActiveTurns(runId, queued);
  const deliveredAt = now();
  for (const item of followUps.get(runId) ?? []) {
    if (item.status === "queued") {
      item.status = "delivered";
      item.deliveredAt = deliveredAt;
    }
  }
  flushRun(runId);
  return queued;
}

export async function archiveRun(runId: string): Promise<Run> {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  run.status = "ARCHIVED";
  run.updatedAt = now();
  inbound.get(runId)?.push({ type: "shutdown", reason: "archived" });
  await persistRunWorkspace(runId).catch((error) => {
    console.error(`failed to persist workspace before archive ${runId}`, error);
  });
  const handle = handles.get(runId);
  if (handle) {
    await getRuntime().destroy(handle);
    handles.delete(runId);
  }
  deleteWorkerLease(runId);
  heartbeats.delete(runId);
  run.workerHandle = null;
  run.vmSlotId = null;
  publish(event(runId, "run.archived", "Run archived"));
  flushRun(runId);
  dropHistory(runId);
  void tryStartQueued();
  return run;
}

export function abortRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    return run;
  }
  if (isWorkerAttached(runId)) {
    inbound.get(runId)?.push({ type: "abort" });
    clearActiveTurn(runId);
    run.updatedAt = now();
    flushRun(runId);
    return run;
  }
  clearActiveTurn(runId);
  inbound.set(runId, []);
  run.status = "IDLE";
  run.errorMessage = null;
  run.workerHandle = null;
  run.vmSlotId = null;
  run.idleAt = now();
  run.updatedAt = now();
  publish(event(runId, "run.idle", "Stopped; worker was not attached"));
  flushRun(runId);
  return run;
}

function requireRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  return run;
}

export function mintRunGitToken(runId: string, input: CreateGitTokenRequest) {
  const run = requireRun(runId);
  const issued = issueRunGitToken(run, input);
  return {
    token: issued.token,
    repoUrl: issued.repoUrl,
    scope: issued.scope,
    expiresAt: issued.expiresAt,
  };
}

export async function commitRun(runId: string, input: CreateCommitRequest) {
  const run = requireRun(runId);
  try {
    const result = await commitRunWorkspace(workspaceFor(runId), input);
    run.updatedAt = now();
    publish(
      event(runId, "scm.commit_succeeded", result.empty ? "Nothing to commit" : "Committed workspace", {
        data: { sha: result.sha, branch: result.branch, empty: result.empty },
      }),
    );
    flushRun(runId);
    return { ...result, branch: run.branchName ?? result.branch };
  } catch (error) {
    const message = error instanceof Error ? error.message : "commit failed";
    publish(event(runId, "scm.commit_failed", "Commit failed", { level: "error", detail: message }));
    flushRun(runId);
    throw error;
  }
}

export async function openRunDraftPr(runId: string, input: CreatePullRequestRequest) {
  const run = requireRun(runId);
  try {
    const result = await openRunPullRequest(workspaceFor(runId), run, input);
    run.pullRequests = [...run.pullRequests.filter((item) => item.branch !== result.pullRequest.branch), result.pullRequest];
    run.updatedAt = now();
    if (result.pushed) {
      publish(
        event(runId, "scm.push_succeeded", `Pushed ${result.pullRequest.branch}`, {
          data: { branch: result.pullRequest.branch, repoUrl: result.pullRequest.repoUrl },
        }),
      );
    }
    publish(
      event(runId, "scm.pr_opened", result.pullRequest.draft ? "Opened draft pull request" : "Opened pull request", {
        data: {
          url: result.pullRequest.url,
          number: result.pullRequest.number,
          title: result.pullRequest.title,
          draft: result.pullRequest.draft,
        },
      }),
    );
    flushRun(runId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "pull request failed";
    publish(event(runId, "scm.pr_failed", "Failed to open pull request", { level: "error", detail: message }));
    flushRun(runId);
    throw error;
  }
}

export function saveRunSession(runId: string, files: Array<{ name: string; content: string }>) {
  requireRun(runId);
  const secrets = controlPlaneSecrets();
  const written = persistSessionFiles(
    runId,
    files.map((file) => ({ name: file.name, content: redactText(file.content, secrets) })),
  );
  scheduleArchive(runId);
  return { files: written };
}

export async function restoreArchivedRun(runId: string) {
  if (runs.has(runId)) {
    return runs.get(runId);
  }
  const restored = await restoreArchivedArtifacts(runId);
  if (!restored?.record?.run?.id) {
    return undefined;
  }
  const run = restored.record.run;
  run.pullRequests = Array.isArray(run.pullRequests) ? run.pullRequests : [];
  run.baseBranch = run.baseBranch ?? null;
  if (LIVE_STATUSES.has(run.status)) {
    run.status = "ERROR";
    run.errorMessage = run.errorMessage ?? "control plane restarted; worker was not recovered";
    run.updatedAt = now();
  }
  runs.set(run.id, run);
  followUps.set(run.id, restored.record.followUps ?? []);
  inbound.set(run.id, restored.record.inbound ?? []);
  subscriptions.set(run.id, restored.record.subscriptions ?? []);
  if (keepHotHistory(run.status)) {
    seedEvents(run.id, restored.events);
  }
  persistRunRecord({
    version: 1,
    run,
    followUps: followUps.get(run.id) ?? [],
    inbound: inbound.get(run.id) ?? [],
    subscriptions: subscriptions.get(run.id) ?? [],
  });
  return run;
}

export function getRunSession(runId: string, options?: { includeContent?: boolean }) {
  requireRun(runId);
  if (options?.includeContent) {
    return { files: loadSessionFiles(runId) };
  }
  return { files: listSessionFiles(runId) };
}

export async function getRunDiff(runId: string) {
  const run = requireRun(runId);
  const diff = await diffRunWorkspace(workspaceFor(runId), run);
  return {
    branch: run.branchName,
    baseBranch: run.baseBranch,
    pullRequests: run.pullRequests,
    ...diff,
  };
}

const DIAGNOSTIC_EVENT_KINDS = new Set([
  "egress.denied",
  "build.used",
  "mcp.auth_error",
]);

export function getRunDiagnostics(runId: string): RunDiagnostics {
  const run = requireRun(runId);
  const env = run.envId ? getEnvironment(run.envId) : undefined;
  const build = run.buildId ? getBuild(run.buildId) : undefined;
  return {
    run: {
      id: run.id,
      status: run.status,
      setupStatus: run.setupStatus,
      envId: run.envId,
      envVersionId: run.envVersionId,
      buildId: run.buildId,
      branchName: run.branchName,
      baseBranch: run.baseBranch,
      model: run.model,
      errorMessage: run.errorMessage,
      repoUrls: run.repoUrls,
    },
    environment: env
      ? { id: env.id, name: env.name, environmentJsonPath: env.environmentJsonPath }
      : null,
    build: build
      ? {
          id: build.id,
          status: build.status,
          draft: build.draft,
          fingerprint: build.fingerprint,
          envVersionId: build.envVersionId,
        }
      : null,
    egress: egressForRun(run),
    events: eventsForRun(runId).filter(
      (item) =>
        item.kind.startsWith("run.") ||
        item.kind.startsWith("scm.") ||
        DIAGNOSTIC_EVENT_KINDS.has(item.kind),
    ),
    logs: readWorkspaceLogTails(workspaceFor(runId)),
  };
}

hydrateFromDisk();
