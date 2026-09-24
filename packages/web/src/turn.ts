import { isActiveRunStatus } from "@neo-cloud-agent/contracts/turn-state";
import { STATUS_LABELS } from "./format";

export { activityLabel, isAssistantStreaming, shouldShowThinking } from "@neo-cloud-agent/contracts/turn-view";

export function turnStatusLabel(input: { sending?: boolean; stopping?: boolean; status?: string | null }): {
  state: string;
  label: string;
} {
  if (input.stopping) return { state: "RUNNING", label: "正在停止" };
  if (input.sending && !isActiveRunStatus(input.status)) return { state: "RUNNING", label: "发送中" };
  const status = input.status ?? "idle";
  return { state: status, label: STATUS_LABELS[status] ?? input.status ?? "就绪" };
}

/** Phone home hides the transcript until a run exists; keep it after send so the bubble is visible. */
export function shouldShowBuddyHome(input: {
  narrow: boolean;
  runId?: string | null;
  loadingTranscript?: boolean;
  pending?: boolean;
  messageCount?: number;
}): boolean {
  return Boolean(
    input.narrow && !input.runId && !input.loadingTranscript && !input.pending && !(input.messageCount ?? 0),
  );
}
