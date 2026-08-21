import { defineExtension } from "./types.js";

export const neoMcp = defineExtension({
  name: "neo-mcp",
  description: "Start HTTP/stdio MCP servers from the environment config. Tokens are injected by the control plane.",
});
