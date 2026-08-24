export const COMPOSER_MAX_PX = 1120;
export const COMPOSER_MAX_RATIO = 0.92;
export const COMPOSER_FOLLOW_MIN = 400;
export const COMPOSER_CHROME = 96;
export const COMPOSER_HOME_TEXTAREA_MIN = 128;
export const COMPOSER_HOME_TEXTAREA_MAX = 240;
export const COMPOSER_FOLLOW_TEXTAREA_MIN = 24;
export const COMPOSER_FOLLOW_TEXTAREA_MAX = COMPOSER_HOME_TEXTAREA_MAX;
export const TRANSCRIPT_MAX_PX = 860;
export const TRANSCRIPT_GUTTER = 48;

export function composerMaxWidth(stageWidth: number): number {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0) return COMPOSER_MAX_PX;
  return Math.max(320, Math.min(COMPOSER_MAX_PX, Math.floor(stageWidth * COMPOSER_MAX_RATIO)));
}

/** Same column as `.feed > *`: min(860px, 100% - 48px). */
export function transcriptColumnWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return TRANSCRIPT_MAX_PX;
  return Math.max(320, Math.min(TRANSCRIPT_MAX_PX, containerWidth - TRANSCRIPT_GUTTER));
}

export function composerBoxWidth(opts: {
  home?: boolean;
  measuredText?: number;
  maxWidth: number;
  chrome?: number;
  followMin?: number;
}): number {
  return opts.maxWidth;
}

export function composerTextareaHeight(scrollHeight: number, home: boolean): number {
  const min = home ? COMPOSER_HOME_TEXTAREA_MIN : COMPOSER_FOLLOW_TEXTAREA_MIN;
  return Math.min(COMPOSER_HOME_TEXTAREA_MAX, Math.max(min, scrollHeight));
}
