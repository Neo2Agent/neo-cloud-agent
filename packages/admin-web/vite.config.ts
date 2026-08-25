import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminApi = (process.env.ADMIN_API_URL ?? "http://127.0.0.1:8090").replace(/\/$/, "");

function publicBase(): string {
  const raw = (process.env.ADMIN_BASE ?? "/").trim() || "/";
  if (raw === "/") {
    return "/";
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export default defineConfig({
  plugins: [react()],
  base: publicBase(),
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
});
