import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { currentTurnMessages, isActiveRunStatus } from "@neo-cloud-agent/contracts/turn-state";
import { STATUS_LABELS } from "./format";

/** "正在回复" only once reply text is visible. */
export function isAssistantStreaming(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some(
    (message) => message.role === "assistant" && message.streaming && Boolean(message.text.trim()),
  );
}

/** Dots only before this turn has anything to show. */
export function shouldShowThinking(busy: boolean, messages: TranscriptMessage[]): boolean {
  if (!busy) return false;
  return !currentTurnMessages(messages).some(
    (message) => message.role === "assistant" && Boolean(message.text.trim() || message.tools?.length),
  );
}

export function activityLabel(input: {
  sending?: boolean;
  stopping?: boolean;
  status?: string | null;
  streaming?: boolean;
  runningTool?: string | null;
}): string {
  if (input.stopping) return "正在停止…";
  if (input.sending) return "正在发送…";
  if (input.status === "NOT_YET_STARTED") return "排队等待空闲 VM…";
  if (input.status === "PROVISIONING") return "正在准备运行环境…";
  if (input.status === "INSTALLING") return "正在安装环境…";
  if (input.runningTool === "neo_subagent") return "正在执行子代理…";
  if (input.runningTool) return `正在执行 ${input.runningTool}…`;
  if (input.streaming) return "正在回复…";
  if (input.status === "WAITING_FOR_BACKGROUND_WORK") return "后台任务进行中…";
  if (input.status === "RUNNING") return "正在思考…";
  return "进行中…";
}

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
