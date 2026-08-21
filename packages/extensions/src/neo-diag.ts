import { defineExtension } from "./types.js";

export const neoDiag = defineExtension({
  name: "neo-diag",
  description: "Let the agent inspect this run's setup logs, egress denials, and environment version.",
});
