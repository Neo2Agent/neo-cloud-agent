import { THEME } from "@neo-cloud-agent/ui/tokens";

/** Same Web monochrome tokens Desk and the lab now share. */
export const ISLAND = {
  bg: THEME.bg,
  rail: THEME.rail,
  stage: THEME.stage,
  card: THEME.panel,
  raised: THEME.raised,
  line: THEME.line,
  ink: THEME.ink,
  muted: THEME.muted,
  hover: THEME.hover,
  accent: THEME.accent,
  cream: THEME.cream,
  green: THEME.green,
  red: THEME.red,
  clay: THEME.clay,
  press: THEME.press,
  font: THEME.font,
} as const;

export function dayGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5 || hour >= 18) return "晚上好";
  if (hour < 12) return "早上好";
  return "下午好";
}
