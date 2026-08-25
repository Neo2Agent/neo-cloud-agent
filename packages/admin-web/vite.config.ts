import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminApi = (process.env.ADMIN_API_URL ?? "http://127.0.0.1:8090").replace(/\/$/, "");

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Relative in production so `/admin/` (Caddy) and `:8090/` both resolve assets.
  base: process.env.ADMIN_WEB_BASE || (mode === "development" ? "/" : "./"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.ADMIN_WEB_PORT ?? 5176),
    strictPort: true,
    proxy: {
      "/v1": adminApi,
      "/health": adminApi,
    },
  },
}));
