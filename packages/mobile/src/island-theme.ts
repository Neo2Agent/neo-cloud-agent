/** Desk 动森 token. Vite CSS and RN screens both read these numbers. */
export const ISLAND = {
  bg: "#f8f8f0",
  rail: "#f0e8d8",
  stage: "#f7f3df",
  card: "#f7f3df",
  raised: "#fffbe7",
  line: "#c4b89e",
  ink: "#794f27",
  muted: "#8a7b66",
  hover: "#d6dff0",
  accent: "#19c8b9",
  cream: "#fff9e3",
  green: "#6fba2c",
  red: "#e05a5a",
  clay: "#d4c9b4",
  press: "#bdaea0",
  font: 'Nunito, "Noto Sans SC", "SF Pro Text", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif',
} as const;

export function dayGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5 || hour >= 18) return "晚上好";
  if (hour < 12) return "早上好";
  return "下午好";
}
