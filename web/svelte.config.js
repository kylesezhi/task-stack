import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  // Route <script lang="ts"> / <style lang="..."> blocks through Vite's
  // pipeline so svelte-check and vite build see the same preprocessing.
  preprocess: vitePreprocess(),
};
