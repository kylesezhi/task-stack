import { defineConfig } from "vitest/config";

// Same pattern as server/shared (T06): node environment, colocated tests.
// A dedicated config here matters: it keeps vite.config.ts's svelte plugin and
// dev proxy out of the test run — no test imports .svelte files, so the svelte
// plugin would be dead weight (and Node-flavored tests must not depend on DOM
// or vite plumbing).
// The real-server smoke (state-client.smoke.test.ts) is env-gated and runs
// only via `pnpm --filter web test:smoke`; `pnpm -r test` shows it skipped and
// green.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
