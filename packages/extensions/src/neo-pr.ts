import { defineExtension } from "./types.js";

export const neoPr = defineExtension({
  name: "neo-pr",
  description: "Ask the control plane to open a draft pull request via POST /internal/runs/:id/scm/pull-request.",
});
