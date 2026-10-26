import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      // Dev-only: the browser talks to Vite alone; Vite forwards /api to the
      // Fastify dev server (T03). Keep the default in sync with PORT/HOST in
      // server/src/index.ts (127.0.0.1:3000). API_PROXY_TARGET is an
      // e2e-only override (web/playwright.config.ts, T17) so Playwright can
      // point a throwaway Vite at a throwaway server on probed free ports.
      // In production there is no proxy — the server serves the built app
      // itself (T15). ws:true also covers the /api/ws upgrade once WebSocket
      // sync lands (T13).
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
