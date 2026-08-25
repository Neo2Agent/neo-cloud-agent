import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
});
