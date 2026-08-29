import { remoteControlSendLock, type Desk } from "@neo-cloud-agent/contracts/desk";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { STATUS_LABELS } from "./format.js";
import { runPlaceLabel } from "./place.js";
import { isComposerClosed } from "./turn.js";

export function composerGate(
  run: Run | null | undefined,
  desks: Array<Pick<Desk, "id" | "online">>,
): { locked: boolean; hint: string; archived: boolean; running: boolean } {
  const archived = isComposerClosed(run?.status);
  const host = remoteControlSendLock(run, desks);
  const locked = Boolean(run) && (archived || host.locked);
  return {
    locked,
    hint: archived ? "对话已归档。" : host.hint,
    archived,
    running: run?.status === "RUNNING",
  };
}

export function chatStatusText(run: Run | null | undefined, desks: Array<Pick<Desk, "id" | "online">>): string {
  const gate = composerGate(run, desks);
  if (gate.running) return "跑着";
  if (gate.locked && gate.hint) return gate.hint;
  return STATUS_LABELS[run?.status ?? ""] ?? run?.status ?? "对话";
}

export function runRowMeta(run: Run): string {
  const status = STATUS_LABELS[run.status] ?? run.status;
  const place = runPlaceLabel(run);
  return `${status} · ${place}`;
}
