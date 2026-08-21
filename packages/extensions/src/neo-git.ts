import { defineExtension } from "./types.js";

export const neoGit = defineExtension({
  name: "neo-git",
  description: "Controlled commit. Sign and push go through scm-service, not a long-lived token in bash.",
});
