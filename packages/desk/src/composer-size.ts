export const COMPOSER_MAX_PX = 1120;
export const COMPOSER_MAX_RATIO = 0.8;
export const COMPOSER_FOLLOW_MIN = 400;
export const COMPOSER_CHROME = 96;
export const COMPOSER_HOME_TEXTAREA_MIN = 104;
export const COMPOSER_HOME_TEXTAREA_MAX = 240;
export const COMPOSER_FOLLOW_TEXTAREA_MIN = 22;
export const COMPOSER_FOLLOW_TEXTAREA_MAX = 160;

export function composerMaxWidth(stageWidth: number): number {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0) return COMPOSER_MAX_PX;
  return Math.max(320, Math.min(COMPOSER_MAX_PX, Math.floor(stageWidth * COMPOSER_MAX_RATIO)));
}

export function composerBoxWidth(opts: {
  home: boolean;
  measuredText: number;
  maxWidth: number;
  chrome?: number;
  followMin?: number;
}): number {
  if (opts.home) return opts.maxWidth;
  const chrome = opts.chrome ?? COMPOSER_CHROME;
  const followMin = opts.followMin ?? COMPOSER_FOLLOW_MIN;
  return Math.min(opts.maxWidth, Math.max(followMin, Math.ceil(opts.measuredText) + chrome));
}

export function composerTextareaHeight(scrollHeight: number, home: boolean): number {
  const min = home ? COMPOSER_HOME_TEXTAREA_MIN : COMPOSER_FOLLOW_TEXTAREA_MIN;
  const max = home ? COMPOSER_HOME_TEXTAREA_MAX : COMPOSER_FOLLOW_TEXTAREA_MAX;
  return Math.min(max, Math.max(min, scrollHeight));
}
