import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig(
  // Flat config ignores .git and node_modules by default but NOT gitignored
  // build output — declare it explicitly.
  {
    ignores: ["**/dist/", "coverage/", "reference/", "web/test-results/", "web/playwright-report/"],
  },
  js.configs.recommended,
  tseslint.configs.recommended, // non-type-checked (deliberate; upgrade path when async server routes land)
  svelte.configs.recommended,
  prettier, // eslint-config-prettier: disable stylistic conflicts; Prettier owns formatting
  svelte.configs.prettier,
  {
    // TS parser must accept .svelte as an "extra" extension (official recipe note)
    languageOptions: {
      parserOptions: { extraFileExtensions: [".svelte"] },
    },
  },
  {
    // Node-side code + tool config files (incl. the Playwright harness, T17)
    files: [
      "server/**/*.ts",
      "eslint.config.mjs",
      "web/svelte.config.js",
      "web/vite.config.ts",
      "web/playwright.config.ts",
      "web/tests/**/*.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["web/src/**/*.{ts,svelte}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // TypeScript inside .svelte script blocks (official recipe; svelteConfig
    // import omitted — auto-discovery is fine for this plain-vite project)
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
);
