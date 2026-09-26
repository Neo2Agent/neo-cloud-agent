import type { RunEvent, TranscriptMessage } from "./events.js";

/** Older snapshots glued title and detail with a fullwidth colon. */
export const SETUP_TITLE_DETAIL_SEP = "：";
/**
 * Title that already ends with `。` plus the join colon.
 * Unique enough to recover a snippet from a persisted `text` field.
 */
export const SETUP_LEGACY_TITLE_DETAIL_MARK = `。${SETUP_TITLE_DETAIL_SEP}`;
export const SETUP_FAIL_DIAG_OPEN_LABEL = "查看诊断";
export const SETUP_FAIL_DIAG_CLOSE_LABEL = "收起诊断";
export const SETUP_FAIL_NO_LOG_TEXT = "没有更多日志";

/**
 * Compile a setup row from a control-plane event.
 * @param event `title` is the short Chinese line; `detail` is the log snippet
 */
export function toSetupTranscriptMessage(event: RunEvent): TranscriptMessage {
  const href = typeof event.data?.url === "string" ? event.data.url : undefined;
  const mediaType = typeof event.data?.contentType === "string" ? event.data.contentType : undefined;
  return {
    id: event.id,
    role: "setup",
    text: event.title,
    detail: event.detail,
    createdAt: event.createdAt,
    kind: event.kind,
    level: event.kind === "run.error" ? (event.level ?? "error") : event.level,
    href,
    mediaType,
  };
}

/**
 * Short failure line for the banner.
 * Persisted snapshots without `detail` may still store `title。：snippet` in `text`.
 */
export function setupFailureTitle(message: TranscriptMessage): string {
  if (message.detail !== undefined) {
    return message.text;
  }
  return splitLegacySetupText(message.text).title;
}

/**
 * Log snippet for the inline expand. Empty when there is no detail.
 */
export function setupFailureDetail(message: TranscriptMessage): string {
  if (message.detail !== undefined) {
    return message.detail;
  }
  return splitLegacySetupText(message.text).detail;
}

/**
 * Text to render inside the expanded log.
 * @returns trimmed detail, or {@link SETUP_FAIL_NO_LOG_TEXT} when there is none
 */
export function setupFailLogText(message: TranscriptMessage): string {
  const detail = setupFailureDetail(message).trim();
  if (!detail) {
    return SETUP_FAIL_NO_LOG_TEXT;
  }
  return detail;
}

/**
 * @param open whether the log snippet is expanded
 */
export function setupDiagToggleLabel(open: boolean): string {
  return open ? SETUP_FAIL_DIAG_CLOSE_LABEL : SETUP_FAIL_DIAG_OPEN_LABEL;
}

function splitLegacySetupText(text: string): { title: string; detail: string } {
  const mark = text.indexOf(SETUP_LEGACY_TITLE_DETAIL_MARK);
  if (mark < 0) {
    return { title: text, detail: "" };
  }
  return {
    title: text.slice(0, mark + 1),
    detail: text.slice(mark + SETUP_LEGACY_TITLE_DETAIL_MARK.length),
  };
}
