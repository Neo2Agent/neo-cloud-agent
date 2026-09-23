export const COMPOSER_HOME_TEXTAREA_MIN = 56;
export const COMPOSER_HOME_TEXTAREA_MAX = 240;
export const COMPOSER_FOLLOW_TEXTAREA_MIN = 24;

/**
 * Grow the textarea with its content, between the two limits.
 *
 * New Chat starts a few lines tall; a follow-up starts on one line. They share
 * a ceiling so the transcript never gets squeezed out.
 */
export function composerTextareaHeight(scrollHeight: number, home: boolean): number {
  const min = home ? COMPOSER_HOME_TEXTAREA_MIN : COMPOSER_FOLLOW_TEXTAREA_MIN;
  return Math.min(COMPOSER_HOME_TEXTAREA_MAX, Math.max(min, scrollHeight));
}
