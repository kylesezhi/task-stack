import { defineConfig } from "vitest/config";

// Tests live alongside sources in src/ so tsc typechecks them too. The tight
// include (src/ only) keeps compiled dist/*.test.js out of test discovery.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
