import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const port = Number(process.env.NEO_DESK_UI_PORT || 5174);
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
});
