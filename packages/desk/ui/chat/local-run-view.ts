import type { Run } from "@neo-cloud-agent/contracts/run";
import { isActiveRunStatus } from "../../src/stream";
import { localRunFolder, type DeskRunStatus } from "../desk";

/** Statuses reported by the main process, keyed by run id. */
export type LocalRunStatuses = Record<string, DeskRunStatus>;

/**
 * What the run bar and the side panel need to know about the open conversation.
 *
 * Two facts have to be combined and they can disagree: the control plane's run
 * status, and whether this machine currently holds a worker process. A worker
 * exits after every turn, so "no process" is the resting state rather than a
 * failure, and only the pair tells idle apart from interrupted.
 */
export type LocalRunView = {
  /** The open run executes on this machine. */
  isLocal: boolean;
  /** The main process's last word on this run, if it ever reported one. */
  status?: DeskRunStatus;
  /** The worker is gone, whatever the run status still says. */
  workerDown: boolean;
  /** The per-turn worker simply finished and nothing is owed. */
  idle: boolean;
  /** Work is owed but nothing holds it, so offer to start it here again. */
  needsRestart: boolean;
  /** The folder this run works in, never the folder the picker shows. */
  folder: string;
};

const NO_LOCAL_RUN: LocalRunView = {
  isLocal: false,
  workerDown: false,
  idle: false,
  needsRestart: false,
  folder: "",
};

export function localRunView(run: Run | null | undefined, statuses: LocalRunStatuses): LocalRunView {
  if (!run || run.executionTarget?.loop !== "desk") {
    return NO_LOCAL_RUN;
  }
  const status = statuses[run.id];
  const workerDown = status?.state === "stopped" || status?.state === "failed";
  // No status at all also means no worker: the main process reports one as soon
  // as it starts, so silence is a run this window never launched.
  const noWorker = !status || status.state === "stopped";
  const owed = isActiveRunStatus(run.status);
  return {
    isLocal: true,
    status,
    workerDown,
    idle: noWorker && !owed,
    needsRestart: noWorker && owed,
    folder: localRunFolder(run),
  };
}

/** Runs holding a worker right now, so the rail can mark them. */
export function runningLocalRunIds(statuses: LocalRunStatuses): Set<string> {
  const ids = new Set<string>();
  for (const status of Object.values(statuses)) {
    if (status.state === "starting" || status.state === "running") {
      ids.add(status.runId);
    }
  }
  return ids;
}

/** How many other local conversations are working, for the "另有 N 条" hint. */
export function otherRunningLocalRuns(statuses: LocalRunStatuses, currentRunId?: string | null): number {
  let count = 0;
  for (const runId of runningLocalRunIds(statuses)) {
    if (runId !== currentRunId) {
      count += 1;
    }
  }
  return count;
}
