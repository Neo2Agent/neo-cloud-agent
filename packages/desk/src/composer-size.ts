/** Widest the composer ever gets, however wide the window is. */
export const COMPOSER_MAX_PX = 1120;

/** Narrowest it gets before it would stop being usable. */
export const COMPOSER_MIN_PX = 320;

/** Share of the chat stage the composer fills below the cap. */
const COMPOSER_MAX_RATIO = 0.92;

export const COMPOSER_HOME_TEXTAREA_MIN = 128;
export const COMPOSER_HOME_TEXTAREA_MAX = 240;
export const COMPOSER_FOLLOW_TEXTAREA_MIN = 24;

export function composerMaxWidth(stageWidth: number): number {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0) {
    return COMPOSER_MAX_PX;
  }
  return Math.max(COMPOSER_MIN_PX, Math.min(COMPOSER_MAX_PX, Math.floor(stageWidth * COMPOSER_MAX_RATIO)));
}

/**
 * Grow the textarea with its content, between the two limits.
 *
 * New Chat starts tall because it is the whole page; a follow-up starts on one
 * line and they share a ceiling so the transcript never gets squeezed out.
 */
export function composerTextareaHeight(scrollHeight: number, home: boolean): number {
  const min = home ? COMPOSER_HOME_TEXTAREA_MIN : COMPOSER_FOLLOW_TEXTAREA_MIN;
  return Math.min(COMPOSER_HOME_TEXTAREA_MAX, Math.max(min, scrollHeight));
}
