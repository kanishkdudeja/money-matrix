import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:6060";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4040,
    proxy: {
      "/api": apiProxyTarget,
      "/health": apiProxyTarget,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
  },
});
