import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
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
  RunStart,
  EgressPolicy,
  ExecutionTarget,
  FollowUp,
  FollowUpDelivery,
  HandoffRequest,
  ProjectRunCard,
  Run,
  TransferRunMode,
  RunDiagnostics,
  RunEvent,
  RunSubscription,
  RuntimeHandle,
  RuntimeSpec,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import {
  assertExecutionTarget,
  buildTranscriptSnapshot,
  conversationReplayFromMessages,
  deskRepoKey,
  evaluateEgress,
  isDeskTarget,
  isDeskToolsTarget,
  resolveAgentKernel,
  MAX_SUBSCRIPTION_WAKES,
  mintRunToken,
  verifyRunToken,
  parseContextUsage,
  parseExecutionTarget,
  parseRunSource,
  parseRunStart,
  parseSubscriptionEvents,
  redactText,
  SUBSCRIPTION_COALESCE_MS,
  subscriptionKindForEvent,
  formatProjectMemory,
  canManageProject,
  subscriptionTargetsFrom,
} from "@neo-cloud-agent/contracts";
import { listRunArtifacts } from "../artifacts/artifacts.js";
import { formatPrArtifactMarkdown } from "../artifacts/signed.js";
import { assertCreateRunAllowed, assertUserCreditAllowed } from "../quota/quota.js";
import { getAccountStore } from "../accounts/store.js";
import { decideSubscriptionWake } from "../subscriptions/autofix.js";
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
import { writeRecalledMemory } from "../memory/inject.js";
import { persistRunWorkspace } from "../runtime/persist-workspace.js";
import { reconcileOrphanVmSlots, vmWorkspaceFor } from "../runtime/vm-slots.js";
import {
  loadWorkspaceMeta,
  markWorkspacePresent,
  reclaimPersistedWorkspaces,
  workspaceReclaimIntervalMs,
} from "../runtime/workspace-store.js";
import { commitRunWorkspace, diffRunWorkspace, issueRunGitToken, openRunPullRequest, prepareRunRepos } from "../scm/scm.js";
import { materializeRepos, measureWorkspaceBytes, repoName } from "../scm/workspace.js";
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
  reclaimPersistedRun,
  replacePersistedEvents,
  resolvePersistedRun,
  restoreSessionToDir,
  type ActiveTurn,
} from "../store/persist.js";
import { assertClientImages, runIndexTitle } from "../store/run-record.js";
import { parseGitHubWebhook, subscriptionMatchesIngress } from "../subscriptions/github.js";
import { publicGitHubWebhookInfo, readGitHubWebhookSecret, verifyGitHubSignature } from "../subscriptions/secret.js";
import { hostWorkspaceFor, repoRoot, workspaceFor } from "../worker-spawn.js";
import {
  applyTurnComplete,
  applyTurnHeartbeat,
  clearLoopHeartbeat,
  dispatchTurn,
  hasQueuedLoopFollowUp,
  queueLoopFollowUp,
  signalTurn,
  takeQueuedLoopFollowUp,
} from "../loop/client.js";
import type { TurnCompleteRequest, TurnHeartbeatRequest } from "@neo-cloud-agent/contracts";
import { assignmentExpertFields, buildExpertFiles, resolveTeam, writeExpertFiles } from "../experts/materialize.js";
import { assignmentPluginFields, buildPluginFiles, writePluginFiles } from "../plugins/materialize.js";
import { resolveEnabledPlugins } from "../plugins/store.js";
import { requireUsableExpert } from "../experts/store.js";
import { getProject, memberRole, projectHasMember, recordProjectEvent } from "../projects/store.js";
import { bindTodoRun } from "../projects/todos.js";
import { listProjectAssetsUnchecked } from "../projects/assets.js";
import { attachHandoffPack, buildHandoffMarkdown } from "../projects/handoff.js";
import { pushInbox } from "../projects/inbox.js";
import {
  dropDeskAssignment,
  findDeskWorkspace,
  getDesk,
  hasInbox,
  isDeskOnline,
  offerDeskAssignment,
  pushDeskInbox,
  touchDesk,
  waitDeskAssignment,
} from "../desks/store.js";
import { deskFollowUpBlockReason, deskRunVisibleRemotely } from "../desks/visibility.js";

const runs = new Map<string, Run>();
const followUps = new Map<string, FollowUp[]>();
const inbound = new Map<string, WorkerInbound[]>();
const subscriptions = new Map<string, RunSubscription[]>();
const runJwts = new Map<string, string>();
const handles = new Map<string, RuntimeHandle>();
const heartbeats = new Map<string, number>();
const pendingLoopStarts = new Map<
  string,
  { delivery: FollowUpDelivery; text: string; images?: import("@neo-cloud-agent/contracts").ImageRef[]; followUpId?: string | null }
>();
const runEgress = new Map<string, EgressPolicy>();
const releasingIdle = new Set<string>();
const activeTurns = new Map<string, ActiveTurn>();
const deskWorkspaces = new Map<string, string>();
let startingQueued = false;
let leaseWatch: ReturnType<typeof setInterval> | null = null;
let lastWorkspaceReclaimAt = 0;

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
  record = resolvePersistedRun({
    version: 1,
    run: record.run,
    followUps: record.followUps ?? [],
    inbound: record.inbound ?? [],
    subscriptions: record.subscriptions ?? [],
    activeTurn: record.activeTurn ?? null,
  });
  const run = record.run;
  if (run.deletedAt) {
    return;
  }
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
  if ((inbound.get(runId) ?? []).some((item) => item.type === "prompt" || item.type === "steer" || item.type === "follow_up")) {
    return true;
  }
  return pendingLoopStarts.has(runId) || hasQueuedLoopFollowUp(runId);
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
  inbound.get(run.id)?.push({
    type: active.type,
    text: active.text,
    images: active.images,
    conversationReplay: conversationReplayFor(run.id),
  });
  publish(
    event(run.id, "followup.queued", "中断的回合已自动排队继续", {
      data: { resume: true, delivery: active.type, text: active.text },
    }),
  );
  return true;
}

/** Worker is mid-flight: an answer or a tool call is open. */
const TURN_OPEN_KINDS = new Set<RunEvent["kind"]>(["message.start", "message.delta", "tool.start", "tool.update"]);

/** Worker yielded: whatever it had open is closed. */
const TURN_CLOSED_KINDS = new Set<RunEvent["kind"]>(["message.end", "tool.end", "agent.end", "run.idle"]);

/**
 * Reattach cannot ask the adopted process what it is doing, so read its log.
 * A turn counts as abandoned only when the worker both yielded and then went
 * quiet for longer than a heartbeat; replaying a live turn would answer twice.
 */
function adoptedTurnLooksAbandoned(runId: string, at = Date.now()): boolean {
  const events = eventsForRun(runId);
  const lastAt = Date.parse(events.at(-1)?.createdAt ?? "");
  if (!Number.isFinite(lastAt) || at - lastAt < workerHeartbeatTimeoutMs()) {
    return false;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const kind = events[index]?.kind;
    if (!kind) {
      continue;
    }
    if (TURN_OPEN_KINDS.has(kind)) {
      return false;
    }
    if (TURN_CLOSED_KINDS.has(kind)) {
      return true;
    }
  }
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
  if (isDeskToolsTarget(run.executionTarget)) {
    const deskId = run.executionTarget.deskId ?? "";
    offerDeskAssignment(deskId, run.id);
    pushDeskInbox(deskId, { kind: "assignment", assignment: assignmentFor(run) });
  }
  if (hasPendingUserInbound(run.id)) {
    queueRun(run, resumed ? "中断的回合已自动排队，空出来会继续" : queuedTitle);
    return;
  }
  settleDetachedRun(run, idleTitle);
}

/**
 * Tear down whatever is running this turn. Cloud handles are destroyed here;
 * a desk worker lives on the user's computer, so we ask that desk to stop it.
 */
async function stopWorker(runId: string, handle: RuntimeHandle, reason?: string): Promise<void> {
  if (handle.runtime === "desk") {
    const deskId = runs.get(runId)?.executionTarget?.deskId ?? "";
    pushDeskInbox(deskId, { kind: "cancel", runId, reason });
    return;
  }
  await getRuntime().destroy(handle);
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
        // Read the log before publishing, or the reattach event is the newest one.
        const abandoned = adoptedTurnLooksAbandoned(run.id);
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
        // Adopt keeps the process but does not replay inbox. A prompt already
        // taken before the restart sits on activeTurn with an empty inbound.
        if (abandoned) {
          requeueActiveTurn(run);
        }
        flushRun(run.id);
        continue;
      }
    } catch (error) {
      console.error(`failed to adopt worker for ${run.id}`, error);
    }
    detachOrQueue(run, "控制面重启后正在排队等待空闲电脑", "控制面已恢复，发送即可继续");
  }
  await reconcileDetachedVmSlots();
  startWorkerLeaseWatch();
  void tryStartQueued();
}

function slotOwnerIsLive(runId: string): boolean {
  const run = runs.get(runId);
  if (!run) {
    return false;
  }
  if (LIVE_STATUSES.has(run.status) && run.status !== "NOT_YET_STARTED") {
    return true;
  }
  return run.status === "IDLE" && handles.has(runId);
}

async function reconcileDetachedVmSlots(): Promise<void> {
  await reconcileOrphanVmSlots(slotOwnerIsLive);
  for (const run of runs.values()) {
    if (slotOwnerIsLive(run.id) || !run.vmSlotId) {
      continue;
    }
    run.vmSlotId = null;
    run.updatedAt = now();
    flushRun(run.id);
  }
}

export function expireStaleWorkers(at = Date.now()): string[] {
  const expired: string[] = [];
  const timeout = workerHeartbeatTimeoutMs();
  for (const run of runs.values()) {
    if (!LIVE_STATUSES.has(run.status) || run.status === "NOT_YET_STARTED") {
      continue;
    }
    const handle = handles.get(run.id);
    if (handle && handle.runtime !== "desk") {
      // Process/container liveness is owned by the runtime. Heartbeats only
      // cover the post-restart gap when adopt() could not reattach.
      continue;
    }
    // Desk workers run on someone else's computer, so there is no local process
    // to watch. Their heartbeat is the only signal that they are still alive.
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
          !isDeskToolsTarget(run.executionTarget) &&
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

export function reclaimAndPublish(exceptRunId?: string, at = Date.now()): string[] {
  const protectedIds = new Set<string>();
  for (const run of runs.values()) {
    if (LIVE_STATUSES.has(run.status) || handles.has(run.id) || vmWorkspaceFor(run.id)) {
      protectedIds.add(run.id);
    }
  }
  const result = reclaimPersistedWorkspaces({
    runs: runs.values(),
    protectedIds,
    exceptRunId,
    now: at,
  });
  for (const item of result.evicted) {
    publish(
      event(item.runId, "workspace.reclaimed", "Workspace reclaimed to free disk", {
        data: { reason: item.reason, bytes: item.bytes },
      }),
    );
    if (runs.has(item.runId)) {
      flushRun(item.runId);
    }
  }
  return result.evicted.map((item) => item.runId);
}

export async function releaseIdleWorker(runId: string): Promise<boolean> {
  const run = runs.get(runId);
  if (!run || run.status !== "IDLE" || !handles.has(runId)) {
    return false;
  }
  const pending = inbound.get(runId) ?? [];
  if (pending.some((item) => item.type !== "shutdown") || hasPendingUserInbound(runId)) {
    return false;
  }
  releasingIdle.add(runId);
  try {
    const persisted = await persistRunWorkspace(runId);
    if (!persisted.ok) {
      publish(
        event(runId, "workspace.persist_failed", "Failed to persist workspace; keeping VM slot", {
          level: "error",
          data: { error: persisted.error },
        }),
      );
      flushRun(runId);
      return false;
    }
    if (!persisted.persisted && persisted.reason === "no-slot" && getConfig().workerRuntime === "vm") {
      publish(
        event(runId, "workspace.persist_failed", "VM slot binding missing; keeping worker", {
          level: "error",
          data: { reason: persisted.reason },
        }),
      );
      flushRun(runId);
      return false;
    }
    reclaimAndPublish(runId);
    inbound.get(runId)?.push({ type: "shutdown", reason: "idle" });
    const handle = handles.get(runId);
    if (handle) {
      await stopWorker(runId, handle, "空闲释放");
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
  if (leftover.some((item) => item.type !== "shutdown") || hasPendingUserInbound(runId)) {
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
    await reconcileDetachedVmSlots();
    return [];
  }
  const queuedWaiting = [...runs.values()].some((run) => run.status === "NOT_YET_STARTED");
  const released: string[] = [];
  for (const run of runs.values()) {
    if (run.status !== "IDLE" || !handles.has(run.id) || !run.idleAt) {
      continue;
    }
    const idleAt = Date.parse(run.idleAt);
    const aged = Number.isFinite(idleAt) && at - idleAt >= ttl;
    if (!aged && !queuedWaiting) {
      continue;
    }
    if (await releaseIdleWorker(run.id)) {
      released.push(run.id);
    }
  }
  await reconcileDetachedVmSlots();
  return released;
}

export function startWorkerLeaseWatch(): void {
  if (leaseWatch) {
    return;
  }
  leaseWatch = setInterval(() => {
    expireStaleWorkers();
    void expireIdleWorkers();
    const at = Date.now();
    if (at - lastWorkspaceReclaimAt >= workspaceReclaimIntervalMs()) {
      lastWorkspaceReclaimAt = at;
      reclaimAndPublish();
    }
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
        : kind.startsWith("run.") ||
            kind.startsWith("scm.") ||
            kind.startsWith("subscription.") ||
            kind.startsWith("workspace.")
          ? "agent_setup"
          : "agent_run"),
    level: extra?.level ?? (kind === "run.error" ? "error" : "info"),
    kind,
    title,
    detail: extra?.detail,
    data: extra?.data,
  };
}

/** Re-mint before this much life is left, so a worker never boots on a dead token. */
const JWT_RENEW_MARGIN_MS = 5 * 60 * 1000;

/**
 * A desk worker outlives one turn, so the cached token can already be expired
 * by the time the run is handed back. Reuse it only while it still works.
 */
function usableRunJwt(run: Run): string {
  const cached = runJwts.get(run.id);
  if (!cached) {
    return mintJwtForRun(run);
  }
  try {
    const claims = verifyRunToken(getConfig().jwtSecret, cached);
    if (claims.exp * 1000 - Date.now() > JWT_RENEW_MARGIN_MS) {
      return cached;
    }
  } catch {
    // expired or signed with an older secret
  }
  return mintJwtForRun(run);
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
    workerRole: run.kernel === "agentscope" ? "tools" : "all",
    neoLoopUrl: run.kernel === "agentscope" ? config.neoLoopUrl : undefined,
    neoLoopToken: run.kernel === "agentscope" ? config.neoLoopToken : undefined,
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
  writeFileSync(path.join(dest, "PROJECT.md"), formatProjectMemory(project, listProjectAssetsUnchecked(project.id)));
}

function expertFilesForRun(run: Run) {
  try {
    if (run.expertTeamId) {
      const team = resolveTeam(run.expertTeamId);
      return team ? buildExpertFiles({ team }) : null;
    }
    if (run.expertId) {
      const expert = requireUsableExpert(run.expertId, { userId: run.userId, projectId: run.projectId });
      return buildExpertFiles({ expert });
    }
  } catch {
    return null;
  }
  return null;
}

function writeExpertRole(run: Run): void {
  const files = expertFilesForRun(run);
  if (files) {
    writeExpertFiles(workspaceFor(run.id), files);
  }
}

function pluginFilesForRun(run: Run, extraIds?: string[]) {
  let wantedSkillNames: string[] | undefined;
  try {
    if (run.expertId) {
      wantedSkillNames = requireUsableExpert(run.expertId, { userId: run.userId, projectId: run.projectId }).skillNames;
    }
  } catch {
    wantedSkillNames = undefined;
  }
  const extras = extraIds ?? run.plugins?.map((item) => item.slug) ?? [];
  return buildPluginFiles({
    plugins: resolveEnabledPlugins({ userId: run.userId, projectId: run.projectId, extraIds: extras }),
    workspaceDir: workspaceFor(run.id),
    wantedSkillNames,
  });
}

function writeRunPlugins(run: Run, extraIds?: string[]): void {
  const files = pluginFilesForRun(run, extraIds);
  writePluginFiles(workspaceFor(run.id), files);
  run.plugins = files.snapshot.plugins;
}

function seedHostCollaborator(run: Run, owner?: { userId?: string; email?: string }): void {
  if (!run.projectId) {
    run.collaborators = [];
    return;
  }
  const userId = owner?.userId ?? run.userId;
  run.collaborators = [
    {
      userId,
      email: owner?.email || userId,
      role: "host",
      joinedAt: run.createdAt,
    },
  ];
}

export function isRunHost(run: Run, userId: string): boolean {
  if (run.collaborators?.some((item) => item.userId === userId && item.role === "host")) {
    return true;
  }
  return run.userId === userId || run.assigneeUserId === userId;
}

export function canInviteRunCollaborator(run: Run, actor: { userId: string }): boolean {
  if (isRunHost(run, actor.userId)) return true;
  return Boolean(run.projectId && canManageProject(memberRole(run.projectId, actor.userId)));
}

export function projectRunCard(run: Run): ProjectRunCard {
  const host = run.collaborators?.find((item) => item.role === "host");
  return {
    id: run.id,
    title: runIndexTitle(run),
    status: run.status,
    projectId: run.projectId ?? "",
    hostUserId: host?.userId ?? run.assigneeUserId ?? run.userId,
    hostEmail: host?.email ?? "",
    loop: run.executionTarget?.loop === "desk" ? "desk" : "cloud",
    updatedAt: run.updatedAt,
    role: host ? "host" : null,
  };
}

export function listProjectRunCards(
  projectId: string,
  actorUserId: string,
  opts: { deskClient?: boolean } = {},
): ProjectRunCard[] {
  return listRuns()
    .filter((run) => run.projectId === projectId)
    .filter((run) => run.userId === actorUserId || run.assigneeUserId === actorUserId || run.collaborators?.some((item) => item.userId === actorUserId))
    .filter((run) => opts.deskClient || deskRunVisibleRemotely(run))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((run) => {
      const card = projectRunCard(run);
      const mine = run.collaborators?.find((item) => item.userId === actorUserId);
      return { ...card, role: mine?.role ?? (isRunHost(run, actorUserId) ? "host" : "editor") };
    });
}

export function inviteRunCollaborator(
  runId: string,
  invitee: { userId: string; email: string },
  actor: { userId: string; email: string },
): Run {
  const run = requireRun(runId);
  if (!run.projectId) {
    throw new Error("只有项目里的对话才能邀请加入");
  }
  if (run.executionTarget?.loop === "desk") {
    throw new Error("本机对话不能邀请加入");
  }
  if (!projectHasMember(run.projectId, invitee.userId)) {
    throw new Error("对方还不是项目成员");
  }
  if (!canInviteRunCollaborator(run, actor)) {
    throw new Error("没有权限邀请加入这条对话");
  }
  const existing = run.collaborators ?? [];
  if (existing.some((item) => item.userId === invitee.userId)) {
    return run;
  }
  run.collaborators = [
    ...existing,
    { userId: invitee.userId, email: invitee.email, role: "editor", joinedAt: now() },
  ];
  run.updatedAt = now();
  flushRun(run.id);
  recordProjectEvent(run.projectId, actor, "run_invite", `邀请 ${invitee.email} 加入了一条对话`);
  pushInbox({
    userId: invitee.userId,
    kind: "invited",
    title: `${actor.email} 邀请你加入一条云端对话`,
    projectId: run.projectId,
    runId: run.id,
  });
  return run;
}

export function removeRunCollaborator(runId: string, userId: string, actor: { userId: string; email: string }): Run {
  const run = requireRun(runId);
  if (!canInviteRunCollaborator(run, actor)) {
    throw new Error("没有权限移出协作者");
  }
  const existing = run.collaborators ?? [];
  const target = existing.find((item) => item.userId === userId);
  if (!target) {
    throw new Error("不是这条对话的协作者");
  }
  if (target.role === "host" && existing.filter((item) => item.role === "host").length <= 1) {
    throw new Error("不能移出最后一位房主");
  }
  run.collaborators = existing.filter((item) => item.userId !== userId);
  run.updatedAt = now();
  flushRun(run.id);
  return run;
}

/**
 * Match a desk target the way Cursor's My Machines does: the desk must belong to
 * the caller, and the bound workspace has to be the one the request asked for.
 * A near miss fails loudly instead of running against the wrong checkout.
 */
function resolveDeskTarget(
  target: ExecutionTarget,
  options: { ownerUserId?: string; start: RunStart; repoUrls: string[] },
): { deskWorkspaceId?: string } {
  const desk = getDesk(target.deskId ?? "");
  if (!desk) {
    throw new Error("本机未登记");
  }
  if (options.ownerUserId && desk.userId !== options.ownerUserId) {
    throw new Error("不是这台本机的主人");
  }
  const dispatch = options.start === "dispatch";
  if (dispatch && desk.allowRemote === false) {
    throw new Error("这台电脑关闭了远程派活");
  }
  if (dispatch && !isDeskOnline(desk)) {
    throw new Error("这台电脑没打开 Desk");
  }
  const bound = desk.workspaces ?? [];
  if (target.deskWorkspaceId) {
    const picked = findDeskWorkspace(desk, { workspaceId: target.deskWorkspaceId });
    if (!picked) {
      throw new Error("这台电脑没有这个本机工作区");
    }
    const wanted = requestedRepoKey(options.repoUrls);
    if (wanted && picked.repoKey !== wanted) {
      throw new Error("这台电脑绑的是别的仓库");
    }
    return { deskWorkspaceId: picked.id };
  }
  if (!dispatch) {
    // The desk itself is calling, so it already knows which folder it authorized.
    return {};
  }
  if (bound.length === 0) {
    throw new Error("这台电脑还没有绑定本机工作区");
  }
  const wanted = requestedRepoKey(options.repoUrls);
  if (!wanted) {
    throw new Error("远程派活需要指定这台电脑上的本机工作区");
  }
  const matched = findDeskWorkspace(desk, { repoKey: wanted });
  if (!matched) {
    throw new Error("这台电脑绑的是别的仓库");
  }
  return { deskWorkspaceId: matched.id };
}

function requestedRepoKey(repoUrls: string[]): string {
  const remote = repoUrls.find((url) => looksRemoteRepo(url));
  return remote ? deskRepoKey({ remoteUrl: remote }) : "";
}

export async function createRun(input: CreateRunRequest, owner?: { userId?: string; orgId?: string; email?: string }): Promise<Run> {
  assertClientImages(input.images);
  const config = getConfig();
  const listed = [...runs.values()];
  assertCreateRunAllowed(listed, owner?.orgId ?? config.orgId);
  if (owner?.userId) {
    const account = await getAccountStore().findUserById(owner.userId);
    assertUserCreditAllowed(listed, account);
  }
  const createdAt = now();
  let repoUrls = Array.isArray(input.repoUrls) ? [...input.repoUrls] : [];
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
  if (repoUrls.length === 0 && input.envId) {
    repoUrls = [...(getEnvironment(input.envId)?.config.repos ?? [])];
  }
  const target = parseExecutionTarget(input.target);
  const kernel = resolveAgentKernel(input.kernel);
  if (target) {
    assertExecutionTarget(target, kernel);
  }
  if (!isDeskToolsTarget(target)) {
    repoUrls = repoUrls.filter((url) => {
      if (looksRemoteRepo(url) || !looksLocalFilesystem(url)) {
        return true;
      }
      return existsSync(url) && statSync(url).isDirectory();
    });
  }
  const start = parseRunStart(input.start) ?? "dispatch";
  if (isDeskToolsTarget(target)) {
    if (input.source === "automation") {
      throw new Error("定时任务不能派到本机");
    }
    const requested = input.deskWorkspaceId?.trim() || target.deskWorkspaceId;
    const resolved = resolveDeskTarget(
      { ...target, deskWorkspaceId: requested },
      { ownerUserId: owner?.userId, start, repoUrls },
    );
    target.deskWorkspaceId = resolved.deskWorkspaceId;
  }
  if (input.expertId && input.expertTeamId) {
    throw new Error("一次对话只能选专家或专家团");
  }
  const expert = input.expertId
    ? requireUsableExpert(input.expertId, { userId: owner?.userId, projectId: projectId ?? input.projectId })
    : null;
  const team = input.expertTeamId ? resolveTeam(input.expertTeamId) : null;
  if (input.expertTeamId && !team) {
    throw new Error("专家团不存在");
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
    source: parseRunSource(input.source) ?? (isDeskToolsTarget(target) ? "desk" : "api"),
    executionTarget: target ?? { loop: "cloud", tools: "cloud" },
    kernel,
    expertId: expert?.id ?? null,
    expertTeamId: team?.id ?? null,
    model: input.model ?? expert?.model ?? config.defaultModel,
    prompt: input.prompt,
    title: runIndexTitle({ prompt: input.prompt }),
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
    notifyChatId: input.notifyChatId?.trim() || null,
    todoId: input.todoId ?? null,
  };
  seedHostCollaborator(run, owner);
  if (input.todoId && projectId) {
    bindTodoRun(input.todoId, run.id, projectId);
  }
  runs.set(run.id, run);
  followUps.set(run.id, []);
  inbound.set(run.id, kernel === "pi" ? [{ type: "prompt", text: input.prompt, images: input.images }] : []);
  if (kernel === "agentscope") {
    pendingLoopStarts.set(run.id, { delivery: "prompt", text: input.prompt, images: input.images });
  }
  subscriptions.set(run.id, []);
  publish(event(run.id, "run.provisioning", "Provisioning worker"));
  publish(
    event(run.id, "user.message", "User message", {
      category: "agent_run",
      data: { text: input.prompt, source: run.source, images: input.images },
    }),
  );
  writeExpertRole(run);
  writeRunPlugins(run, input.pluginIds);
  mintJwtForRun(run);
  flushRun(run.id);

  if (isDeskToolsTarget(run.executionTarget)) {
    if (start === "inline") {
      // The caller is that desk: it spawns the worker from this response, so
      // there is nothing to hand out and nothing to wait for.
      queueRun(run, "正在这台电脑上启动 Agent");
      return run;
    }
    dispatchToDesk(run, owner?.email);
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
    await writeRecalledMemory(run);
    writeExpertRole(run);
    writeRunPlugins(run, input.pluginIds);
    flushRun(run.id);
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
  const handle = await getRuntime().provision(launchSpec(run, usableRunJwt(run)), {
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
  void startPendingLoopTurn(run);
}

async function startPendingLoopTurn(run: Run): Promise<void> {
  if ((run.kernel ?? "pi") !== "agentscope") {
    return;
  }
  const pending = pendingLoopStarts.get(run.id) ?? { delivery: "prompt" as const, text: run.prompt };
  pendingLoopStarts.delete(run.id);
  try {
    await dispatchTurn(run, usableRunJwt(run), pending);
    flushRun(run.id);
  } catch (error) {
    console.error(`neo-loop dispatch failed for ${run.id}`, error);
  }
}

export async function resumeRun(runId: string): Promise<Run> {
  const run = requireRun(runId);
  if (isWorkerAttached(runId)) {
    return run;
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  if (isDeskToolsTarget(run.executionTarget)) {
    dispatchToDesk(run);
    return run;
  }
  if (loadWorkspaceMeta(runId)?.state === "evicted" && run.repoUrls.length > 0) {
    try {
      await materializeRepos(run.repoUrls, hostWorkspaceFor(runId), repoRoot());
      markWorkspacePresent(runId, measureWorkspaceBytes(hostWorkspaceFor(runId)));
      publish(event(runId, "workspace.restored", "Workspace restored from repo after reclaim"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "workspace restore failed";
      publish(
        event(runId, "workspace.persist_failed", "Failed to restore workspace from repo", {
          level: "warn",
          data: { error: message },
        }),
      );
    }
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

async function ensureEventsLoaded(runId: string): Promise<void> {
  if (eventsForRun(runId).length > 0) {
    return;
  }
  try {
    const { getPostgresStore } = await import("../platform.js");
    const events = (await getPostgresStore()?.loadEvents(runId)) ?? [];
    if (events.length > 0) {
      replacePersistedEvents(runId, events);
      seedEvents(runId, events);
    }
  } catch {
    // mysql / postgres is optional
  }
}

export async function loadRunIntoMemory(runId: string): Promise<Run | undefined> {
  const existing = runs.get(runId);
  if (existing) {
    if (existing.deletedAt) {
      forgetDeletedRun(runId);
      return undefined;
    }
    await ensureEventsLoaded(runId);
    return existing;
  }
  const local = loadPersistedRun(runId);
  if (local?.run?.id) {
    if (local.run.deletedAt) {
      return undefined;
    }
    hydrateRecord(local);
    await ensureEventsLoaded(runId);
    return local.run;
  }
  try {
    const { getPostgresStore } = await import("../platform.js");
    const store = getPostgresStore();
    const remote = await store?.loadRun(runId);
    if (remote?.run?.id) {
      if (remote.run.deletedAt) {
        return undefined;
      }
      persistRunRecord(remote, undefined, { mirror: false });
      await ensureEventsLoaded(runId);
      hydrateRecord(remote);
      return remote.run;
    }
  } catch {
    // postgres is optional
  }
  return restoreArchivedRun(runId);
}

export async function transferRun(
  runId: string,
  toUserId: string,
  actor: { userId: string; email: string },
  note = "",
  mode?: TransferRunMode,
): Promise<Run> {
  const run = requireRun(runId);
  if (!run.projectId) {
    throw new Error("只有项目里的对话才能转交");
  }
  if (!projectHasMember(run.projectId, toUserId)) {
    throw new Error("对方还不是项目成员");
  }
  if (!isRunHost(run, actor.userId) && !canManageProject(memberRole(run.projectId, actor.userId))) {
    throw new Error("没有权限转交");
  }
  const resolved: TransferRunMode = mode ?? (run.executionTarget?.loop === "desk" ? "fork" : "reassign");
  if (resolved === "fork") {
    const pack = buildHandoffMarkdown(run, note, actor.email);
    const summary = (pack || [`交接自 ${run.id}`, note.trim(), `原任务：${run.prompt.slice(0, 800)}`].filter(Boolean).join("\n")).slice(0, 2400);
    const forked = await createRun(
      {
        prompt: summary,
        repoUrls: run.repoUrls,
        projectId: run.projectId,
        source: run.source === "desk" ? "desk" : "web",
        todoId: run.todoId ?? undefined,
        expertId: run.expertId ?? undefined,
        expertTeamId: run.expertTeamId ?? undefined,
      },
      { userId: toUserId, orgId: run.orgId },
    );
    await attachHandoffPack({ source: run, target: forked, actor, note }).catch(() => undefined);
    recordProjectEvent(run.projectId, actor, "transferred", note.trim() ? `分出了新对话：${note.trim()}` : "分出了一条新对话");
    pushInbox({ userId: toUserId, kind: "transfer", title: `${actor.email} 给你开了一条新对话`, projectId: run.projectId, runId: forked.id });
    return forked;
  }
  const previous = run.collaborators ?? [];
  const toEmail = previous.find((item) => item.userId === toUserId)?.email || toUserId;
  run.collaborators = [
    ...previous
      .filter((item) => item.userId !== toUserId)
      .map((item) => (item.userId === run.userId || item.role === "host" ? { ...item, role: "editor" as const } : item)),
    { userId: toUserId, email: toEmail, role: "host", joinedAt: previous.find((item) => item.userId === toUserId)?.joinedAt ?? now() },
  ];
  run.userId = toUserId;
  run.assigneeUserId = toUserId;
  run.updatedAt = now();
  flushRun(run.id);
  await attachHandoffPack({ source: run, target: run, actor, note }).catch(() => undefined);
  recordProjectEvent(run.projectId, actor, "transferred", note.trim() ? `转交了对话：${note.trim()}` : "转交了一条对话");
  pushInbox({ userId: toUserId, kind: "transfer", title: `${actor.email} 把一条对话转交给你`, projectId: run.projectId, runId: run.id });
  return run;
}

export function listRuns(): Run[] {
  return [...runs.values()].filter((run) => !run.deletedAt);
}

function assignmentFor(run: Run, requestedBy?: string | null): DeskAssignment {
  const config = getConfig();
  const files = expertFilesForRun(run);
  return {
    runId: run.id,
    jwt: usableRunJwt(run),
    model: run.model,
    prompt: run.prompt,
    repoUrls: run.repoUrls,
    controlPlaneUrl: config.controlPlaneUrl,
    llmGatewayUrl: config.workerLlmGatewayUrl,
    target: run.executionTarget ?? { loop: "desk", tools: "desk" },
    workspaceId: run.executionTarget?.deskWorkspaceId ?? null,
    requestedBy: requestedBy ?? null,
    expertId: run.expertId ?? null,
    expertTeamId: run.expertTeamId ?? null,
    ...assignmentExpertFields(files),
    ...assignmentPluginFields(pluginFilesForRun(run)),
    kernel: run.kernel ?? "pi",
    neoLoopUrl: run.kernel === "agentscope" ? config.neoLoopUrl : undefined,
    neoLoopToken: run.kernel === "agentscope" ? config.neoLoopToken : undefined,
  };
}

/**
 * Everything the calling desk needs to spawn its own worker. Used by the inline
 * path, where the desk is the one that just created the run.
 */
export function deskAssignmentForRun(runId: string): DeskAssignment {
  const run = requireRun(runId);
  if (!isDeskToolsTarget(run.executionTarget)) {
    throw new Error("run is not a desk run");
  }
  return assignmentFor(run);
}

/** Notify the desk over its own outbound stream, and keep a lease offer as fallback. */
function dispatchToDesk(run: Run, requestedBy?: string | null): void {
  const deskId = run.executionTarget?.deskId ?? "";
  offerDeskAssignment(deskId, run.id);
  const delivered = pushDeskInbox(deskId, { kind: "assignment", assignment: assignmentFor(run, requestedBy) });
  queueRun(run, delivered ? "已派给这台电脑，等待启动" : "等待这台电脑上线");
}

/** Desk could not take the run. Surface why instead of leaving it queued forever. */
export function rejectDeskRun(deskId: string, runId: string, reason?: string): Run {
  const run = requireRun(runId);
  if (!isDeskToolsTarget(run.executionTarget) || run.executionTarget?.deskId !== deskId) {
    throw new Error("run is not assigned to this desk");
  }
  dropDeskAssignment(deskId, runId);
  touchDesk(deskId);
  clearActiveTurn(runId);
  inbound.set(runId, []);
  run.status = "ERROR";
  run.errorMessage = reason?.trim() || "这台电脑没有接下这条对话";
  run.workerHandle = null;
  run.updatedAt = now();
  publish(event(runId, "run.error", run.errorMessage));
  flushRun(runId);
  return run;
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
  if (!isDeskToolsTarget(run.executionTarget) || run.executionTarget?.deskId !== deskId) {
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
  void startPendingLoopTurn(run);
  return run;
}

/**
 * A desk worker exits after its turn, so the desk says so instead of leaving a
 * handle behind. Without this the next follow-up thinks a worker is still there
 * and never gets dispatched back to the machine.
 */
export function releaseDeskRun(deskId: string, runId: string, input: { code?: number | null } = {}): Run {
  const run = requireRun(runId);
  if (!isDeskToolsTarget(run.executionTarget) || run.executionTarget?.deskId !== deskId) {
    throw new Error("run is not assigned to this desk");
  }
  touchDesk(deskId);
  handles.delete(runId);
  deleteWorkerLease(runId);
  heartbeats.delete(runId);
  run.workerHandle = null;
  run.vmSlotId = null;
  const failed = input.code != null && input.code !== 0;
  if (failed && run.status === "RUNNING") {
    failRun(run, `本机 worker 退出（${input.code}）`);
    return run;
  }
  if (run.status === "RUNNING" && !hasPendingUserInbound(runId)) {
    clearActiveTurn(runId);
    run.status = "IDLE";
    run.idleAt = now();
  }
  run.updatedAt = now();
  flushRun(runId);
  if (hasPendingUserInbound(runId)) {
    // Work arrived while the process was on its way out; hand it back.
    dispatchToDesk(run);
  }
  return run;
}

function looksRemoteRepo(url: string): boolean {
  return /^(https?:\/\/|git@|github\.com\/)/i.test(url);
}

function looksLocalFilesystem(url: string): boolean {
  const text = url.trim();
  return text.startsWith("/") || text.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(text);
}

export async function handoffRun(runId: string, input: HandoffRequest): Promise<Run> {
  const run = requireRun(runId);
  const target = parseExecutionTarget(input.target);
  if (!target) {
    throw new Error("invalid execution target");
  }
  assertExecutionTarget(target, run.kernel ?? "pi");
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  // A This Computer conversation stays on that computer. Its work sits in the
  // user's own folder, usually uncommitted, so "move it to the cloud" would
  // quietly leave the actual changes behind.
  if (isDeskTarget(run.executionTarget) && !isDeskTarget(target)) {
    throw new Error("本机对话不能切到云端。要在云端跑就开一条新的云端对话。");
  }
  const handle = handles.get(runId);
  if (handle) {
    inbound.get(runId)?.push({ type: "shutdown", reason: "idle" });
    await stopWorker(runId, handle, "对话已切换执行位置");
    handles.delete(runId);
    deleteWorkerLease(runId);
    heartbeats.delete(runId);
    run.workerHandle = null;
    run.vmSlotId = null;
  }
  if (isDeskToolsTarget(target)) {
    // Same posture as Cursor: only pull back to a machine that already has this
    // repo bound. No generic "clone it somewhere" fallback.
    const resolved = resolveDeskTarget(
      { ...target, deskWorkspaceId: input.deskWorkspaceId?.trim() || target.deskWorkspaceId },
      { ownerUserId: run.userId, start: "dispatch", repoUrls: run.repoUrls },
    );
    target.deskWorkspaceId = resolved.deskWorkspaceId;
    run.executionTarget = target;
    run.updatedAt = now();
    dispatchToDesk(run);
    return run;
  }
  run.executionTarget = target;
  run.updatedAt = now();
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
    jwt: usableRunJwt(run),
    llmGatewayUrl: config.workerLlmGatewayUrl,
    workspaceDir: isDeskToolsTarget(run.executionTarget)
      ? (deskWorkspaces.get(runId) ?? "")
      : config.workerRuntime === "docker"
        ? config.workerWorkspaceMount
        : workspaceFor(runId),
    egress: egressForRun(run),
  };
}

export function completeLoopTurn(runId: string, body: TurnCompleteRequest): void {
  const run = requireRun(runId);
  applyTurnComplete(run, body);
  applyTurnHeartbeat(runId, { turnId: body.turnId, phase: "done" });
  if (body.status === "waiting_for_background") {
    run.status = "WAITING_FOR_BACKGROUND_WORK";
    run.updatedAt = now();
    flushRun(runId);
    return;
  }
  if (body.status === "error" && !body.cancelled) {
    failRun(run, body.errorMessage || "neo-loop turn failed");
    return;
  }
  ingestEvents(runId, [
    {
      id: crypto.randomUUID(),
      runId,
      createdAt: now(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: body.cancelled ? "Turn cancelled" : "Agent turn finished",
    },
  ]);
  const next = takeQueuedLoopFollowUp(runId);
  if (next) {
    pendingLoopStarts.set(runId, { delivery: "prompt", text: next.text, images: next.images, followUpId: next.followUpId });
    void startPendingLoopTurn(run);
  }
}

export function heartbeatLoopTurn(runId: string, body: TurnHeartbeatRequest): void {
  requireRun(runId);
  applyTurnHeartbeat(runId, body);
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

export async function enqueueFollowUp(
  runId: string,
  input: CreateFollowUpRequest,
  actor?: { userId: string; email: string },
): Promise<FollowUp> {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    throw new Error(`run ${run.status.toLowerCase()}: ${runId}`);
  }
  assertClientImages(input.images);
  const creditUserId = actor?.userId ?? run.userId;
  if (creditUserId) {
    const account = await getAccountStore().findUserById(creditUserId);
    assertUserCreditAllowed([...runs.values()], account);
  }
  const deskBlock = deskFollowUpBlockReason(run, hasInbox);
  if (deskBlock) {
    throw new Error(deskBlock);
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
    source: input.source ?? "user",
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    createdAt: now(),
    deliveredAt: null,
  };
  followUps.get(runId)?.push(item);
  if ((run.kernel ?? "pi") === "agentscope") {
    if (run.status === "RUNNING" && delivery === "steer" && run.currentTurnId) {
      void signalTurn(run, { type: "steer", text: input.text, followUpId: item.id }).catch((error) => {
        console.error(`neo-loop steer failed for ${runId}`, error);
      });
    } else if (run.status === "RUNNING" && delivery === "follow_up") {
      queueLoopFollowUp(runId, { text: input.text, images: input.images, followUpId: item.id });
    } else {
      pendingLoopStarts.set(runId, {
        delivery,
        text: input.text,
        images: input.images,
        followUpId: item.id,
      });
    }
  } else {
    inbound.get(runId)?.push({
      type: delivery,
      text: input.text,
      images: input.images,
      followUpId: item.id,
      conversationReplay: conversationReplayFor(runId),
    });
  }
  publish(
    event(runId, "followup.queued", "Follow-up queued", {
      data: {
        followUpId: item.id,
        delivery,
        text: input.text,
        actorUserId: actor?.userId,
        actorEmail: actor?.email,
      },
    }),
  );
  flushRun(runId);
  if (!isWorkerAttached(runId)) {
    try {
      await resumeRun(runId);
    } catch {
      // follow-up stays queued; resumeRun queued or marked ERROR
    }
  } else if ((run.kernel ?? "pi") === "agentscope" && run.status !== "RUNNING") {
    // Worker is still leased after IDLE. Dispatch the turn now; do not wait for
    // idle-release + resume, which never happens when WORKER_IDLE_RELEASE_MS=0.
    void startPendingLoopTurn(run);
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
        mode: input.mode ?? (kind === "github_ci" ? "autofix" : "watch"),
        autofixCount: 0,
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
      if (ingress.kind === "human_push") {
        run.blockAutofix = true;
        run.updatedAt = now();
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
      const decision = decideSubscriptionWake({
        subscription: item,
        ingress,
        pullRequests: run.pullRequests,
        followUps: followUps.get(runId) ?? [],
        blockAutofix: run.blockAutofix,
      });
      if (decision.action === "skip") {
        continue;
      }
      item.lastDeliveryKey = ingress.deliveryKey;
      item.lastDeliveredAt = now();
      item.wakeCount += 1;
      if (decision.action === "autofix") {
        item.autofixCount = (item.autofixCount ?? 0) + 1;
      }
      publish(
        event(runId, "subscription.delivered", "GitHub subscription event", {
          category: "agent_setup",
          data: {
            subscriptionId: item.id,
            kind: item.kind,
            repo: item.repo,
            deliveryKey: ingress.deliveryKey,
            wakeCount: item.wakeCount,
            autofixCount: item.autofixCount ?? 0,
            mode: decision.action,
          },
        }),
      );
      await enqueueFollowUp(runId, {
        text: decision.text,
        source: decision.action === "autofix" ? "autofix" : "subscription",
      });
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

function conversationReplayFor(runId: string): string | undefined {
  const replay = conversationReplayFromMessages(buildTranscriptSnapshot(runId, eventsForRun(runId)).messages);
  return replay || undefined;
}

function publishFollowUpUserMessage(item: FollowUp): void {
  publish(
    event(item.runId, "user.message", "User message", {
      category: "agent_run",
      data: {
        text: item.text,
        followUpId: item.id,
        delivery: item.delivery,
        images: item.images,
        actorUserId: item.actorUserId,
        actorEmail: item.actorEmail,
      },
    }),
  );
}

function deliverTakenFollowUps(runId: string, taken: WorkerInbound[]): void {
  const deliveredAt = now();
  const byId = new Map((followUps.get(runId) ?? []).map((item) => [item.id, item]));
  for (const inboundItem of taken) {
    if (inboundItem.type !== "prompt" && inboundItem.type !== "steer" && inboundItem.type !== "follow_up") {
      continue;
    }
    const item = inboundItem.followUpId ? byId.get(inboundItem.followUpId) : undefined;
    if (!item || item.status !== "queued") {
      continue;
    }
    item.status = "delivered";
    item.deliveredAt = deliveredAt;
    publish(
      event(runId, "followup.delivered", "Follow-up delivered", {
        data: {
          followUpId: item.id,
          delivery: item.delivery,
          actorUserId: item.actorUserId,
          actorEmail: item.actorEmail,
        },
      }),
    );
    publishFollowUpUserMessage(item);
  }
}

export function takeInbound(runId: string): WorkerInbound[] {
  noteWorkerHeartbeat(runId);
  const queued = inbound.get(runId) ?? [];
  inbound.set(runId, []);
  rememberActiveTurns(runId, queued);
  deliverTakenFollowUps(runId, queued);
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
  const persisted = await persistRunWorkspace(runId);
  if (!persisted.ok) {
    publish(
      event(runId, "workspace.persist_failed", "Failed to persist workspace before archive", {
        level: "error",
        data: { error: persisted.error },
      }),
    );
  }
  reclaimAndPublish(runId);
  const handle = handles.get(runId);
  if (handle) {
    await stopWorker(runId, handle, "对话已归档");
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

export class RunDeleteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function forgetDeletedRun(runId: string): void {
  runs.delete(runId);
  followUps.delete(runId);
  inbound.delete(runId);
  subscriptions.delete(runId);
  activeTurns.delete(runId);
  heartbeats.delete(runId);
  handles.delete(runId);
  runJwts.delete(runId);
  runEgress.delete(runId);
  deskWorkspaces.delete(runId);
  releasingIdle.delete(runId);
}

export async function deleteRun(runId: string): Promise<{ ok: true; id: string; deletedAt: string }> {
  const run = runs.get(runId);
  if (!run || run.deletedAt) {
    throw new RunDeleteError("run not found", 404);
  }
  if (run.status !== "ARCHIVED" && run.status !== "EXPIRED") {
    throw new RunDeleteError("只能删除已归档的任务", 409);
  }
  const deletedAt = now();
  run.deletedAt = deletedAt;
  run.updatedAt = deletedAt;
  publish(event(runId, "run.deleted", "Run deleted"));
  flushRun(runId);
  reclaimPersistedRun(runId);
  dropHistory(runId);
  forgetDeletedRun(runId);
  return { ok: true, id: runId, deletedAt };
}

export function abortRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    return run;
  }
  clearActiveTurn(runId);
  inbound.get(runId)?.push({ type: "abort" });
  if ((run.kernel ?? "pi") === "agentscope" && run.currentTurnId) {
    void signalTurn(run, { type: "abort" }).catch((error) => {
      console.error(`neo-loop abort failed for ${runId}`, error);
    });
    clearLoopHeartbeat(runId);
  }
  if (isDeskToolsTarget(run.executionTarget)) {
    pushDeskInbox(run.executionTarget.deskId ?? "", { kind: "cancel", runId, reason: "用户停止" });
    run.status = "IDLE";
    run.errorMessage = null;
    run.idleAt = now();
    run.updatedAt = now();
    publish(event(runId, "run.idle", "Stopped"));
    flushRun(runId);
    return run;
  }
  const handle = handles.get(runId);
  inbound.set(runId, []);
  run.status = "IDLE";
  run.errorMessage = null;
  run.idleAt = now();
  run.updatedAt = now();
  if (handle) {
    publish(event(runId, "run.idle", "Stopped"));
    flushRun(runId);
    void stopWorker(runId, handle, "用户停止")
      .catch((error) => {
        console.error(`abort stopWorker failed for ${runId}`, error);
      })
      .finally(() => {
        handles.delete(runId);
        deleteWorkerLease(runId);
        heartbeats.delete(runId);
        const current = runs.get(runId);
        if (current) {
          current.workerHandle = null;
          current.vmSlotId = null;
          current.updatedAt = now();
          flushRun(runId);
        }
        void tryStartQueued();
      });
    return run;
  }
  run.workerHandle = null;
  run.vmSlotId = null;
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

/**
 * Git runs where the files are. A desk run's files are on someone's laptop, so
 * `workspaceFor` points at a directory this host does not have — which used to
 * surface as a baffling `spawn git ENOENT`.
 */
function gitCwdFor(runId: string): string {
  const run = runs.get(runId);
  if (!isDeskToolsTarget(run?.executionTarget)) {
    return workspaceFor(runId);
  }
  const folder = deskWorkspaces.get(runId) ?? "";
  if (!folder || !existsSync(folder)) {
    throw new Error("这条对话的文件在那台电脑上，控制面看不到；请在本机用 git 提交");
  }
  return folder;
}

export async function commitRun(runId: string, input: CreateCommitRequest) {
  const run = requireRun(runId);
  try {
    const result = await commitRunWorkspace(gitCwdFor(runId), input);
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
    const extra = formatPrArtifactMarkdown(runId, await listRunArtifacts(runId));
    const result = await openRunPullRequest(gitCwdFor(runId), run, {
      ...input,
      body: [input.body, extra].filter((part) => part && part.trim()).join("\n\n"),
    });
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
    try {
      subscribeRun(runId, { events: ["pr_activity", "ci"] });
    } catch {
      // local-only repos have no GitHub slug
    }
    flushRun(runId);
    void import("../notify/dispatch.js")
      .then(({ notifyPrReady }) => notifyPrReady(run))
      .catch(() => undefined);
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
    const existing = runs.get(runId);
    if (existing?.deletedAt) {
      forgetDeletedRun(runId);
      return undefined;
    }
    return existing;
  }
  if (loadPersistedRun(runId)?.run?.deletedAt) {
    return undefined;
  }
  const restored = await restoreArchivedArtifacts(runId);
  if (!restored?.record?.run?.id || restored.record.run.deletedAt) {
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
  persistRunRecord({
    version: 1,
    run,
    followUps: restored.record.followUps ?? [],
    inbound: restored.record.inbound ?? [],
    subscriptions: restored.record.subscriptions ?? [],
    activeTurn: restored.record.activeTurn,
  });
  hydrateRecord(restored.record);
  if (keepHotHistory(run.status) && !eventsForRun(run.id).length) {
    seedEvents(run.id, restored.events);
  }
  return runs.get(run.id) ?? run;
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
  // A desk run is diffed by the desk itself; this host has no such folder.
  const cwd = isDeskToolsTarget(run.executionTarget) ? (deskWorkspaces.get(runId) ?? "") : workspaceFor(runId);
  const diff = cwd && existsSync(cwd) ? await diffRunWorkspace(cwd, run) : { stat: "", patch: "" };
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
