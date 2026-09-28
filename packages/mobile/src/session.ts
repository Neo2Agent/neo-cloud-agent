import {
  REMOTE_CLOUD_CONTINUE_STATUS,
  remoteCloudContinueCopy,
  remoteCloudContinueOffer,
  remoteControlSendLock,
  type Desk,
  type RemoteCloudContinueCopy,
  type RemoteCloudContinueOffer,
} from "@neo-cloud-agent/contracts/desk";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { STATUS_LABELS } from "./format.js";
import { runPlaceLabel } from "./place.js";
import { isComposerClosed } from "@neo-cloud-agent/contracts/turn-state";

export function composerGate(
  run: Run | null | undefined,
  desks: Array<Pick<Desk, "id" | "online">>,
): {
  locked: boolean;
  hint: string;
  archived: boolean;
  running: boolean;
  cloudContinue: RemoteCloudContinueOffer;
  continueCopy: RemoteCloudContinueCopy;
} {
  const archived = isComposerClosed(run?.status);
  const host = remoteControlSendLock(run, desks);
  const locked = Boolean(run) && (archived || host.locked);
  const cloudContinue = remoteCloudContinueOffer(run, desks);
  const continueCopy = remoteCloudContinueCopy(cloudContinue);
  return {
    locked,
    hint: archived ? "对话已归档。" : cloudContinue.show ? continueCopy.composerHint : host.hint,
    archived,
    running: run?.status === "RUNNING",
    cloudContinue,
    continueCopy,
  };
}

export function chatStatusText(run: Run | null | undefined, desks: Array<Pick<Desk, "id" | "online">>): string {
  const gate = composerGate(run, desks);
  if (gate.locked && !gate.archived) return REMOTE_CLOUD_CONTINUE_STATUS;
  if (gate.running) return "跑着";
  return STATUS_LABELS[run?.status ?? ""] ?? run?.status ?? "对话";
}

export function runRowMeta(run: Run): string {
  const status = STATUS_LABELS[run.status] ?? run.status;
  const place = runPlaceLabel(run);
  return `${status} · ${place}`;
}
