import { defineExtension } from "./types.js";

export const neoGit = defineExtension({
  name: "neo-git",
  description:
    "Controlled commit via POST /internal/runs/:id/scm/commit. Push uses a short-lived token from the control plane, never a long-lived git credential in bash.",
});
