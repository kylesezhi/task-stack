import { defineConfig } from "vitest/config";

// Tests live alongside sources in src/ so tsc typechecks them too. The tight
// include (src/ only) keeps compiled dist/*.test.js out of test discovery.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Clears WEB_DIST_PATH before every file — an operator's ambient env must
    // not decide whether test apps serve a static root (src/test-setup.ts).
    setupFiles: ["src/test-setup.ts"],
  },
});
