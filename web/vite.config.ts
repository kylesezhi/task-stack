import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      // Dev-only: the browser talks to Vite alone; Vite forwards /api to the
      // Fastify dev server (T03). Keep the target in sync with PORT/HOST in
      // server/src/index.ts (default 127.0.0.1:3000). In production there is
      // no proxy — the server serves the built app itself (T15). ws:true also
      // covers the /api/ws upgrade once WebSocket sync lands (T13).
      "/api": {
        target: "http://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
