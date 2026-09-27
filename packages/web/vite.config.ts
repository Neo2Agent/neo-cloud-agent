import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiBase = (process.env.NEO_CONTROL_PLANE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const port = Number(process.env.NEO_WEB_PORT || 5173);
const shell = process.env.NEO_SHELL === "mobile" ? "mobile" : "desktop";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "neo-shell",
      transformIndexHtml(html) {
        if (shell !== "mobile") return html;
        return html.replace("<html", '<html data-neo-shell="mobile"');
      },
    },
  ],
  define: {
    "import.meta.env.NEO_SHELL": JSON.stringify(shell),
  },
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      "/v1": { target: apiBase, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/health": { target: apiBase, changeOrigin: true },
    },
  },
});
