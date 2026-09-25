/** Shared chrome tokens. CSS lives in `tokens.css`; RN/TS clients read this object. */
export const THEME = {
  bg: "#f4f4f5",
  bg2: "#ffffff",
  rail: "#ffffff",
  stage: "#f4f4f5",
  panel: "#ffffff",
  card: "#ffffff",
  raised: "#ffffff",
  line: "#e8e8e8",
  text: "#1c1c1c",
  muted: "#5c5c5c",
  accent: "#1c1c1c",
  accent2: "#2e2e2e",
  user: "#efefef",
  ok: "#3f3f3f",
  err: "#b42318",
  run: "#1c1c1c",
  ink: "#1c1c1c",
  hover: "#f0f0f1",
  cream: "#ffffff",
  green: "#3f3f3f",
  red: "#b42318",
  clay: "#e8e8e8",
  press: "#e8e8ea",
  font: '"Geist Sans", "WenQuanYi Micro Hei", "PingFang SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
} as const;

export type ThemeTokens = typeof THEME;
