<script lang="ts">
  /**
   * Inline SVG icons (the mockups' Material Symbols glyphs, drawn as
   * 24px-viewBox paths) — the app's one icon source. The mockups load the
   * Material Symbols webfont from a CDN; DECISIONS.md §8 self-hosts every
   * asset, and a whole icon font for a handful of glyphs is the wrong
   * weight — the same shapes inline as SVG, tinted by currentColor (the
   * token guard never scans markup, and currentColor is an allowed keyword
   * regardless). Paths are the Apache-2.0 Material Design icons.
   *
   * Every icon is decorative chrome: the svg is aria-hidden and the owning
   * button keeps its text label (visible or aria-label), so AT never loses
   * a name. Keep the set tiny — add a path only when a screen needs it.
   */
  interface Props {
    /** Which glyph to draw. */
    name: "toss" | "edit" | "push" | "arrow" | "close" | "delete" | "grip" | "kebab";
    /** Rendered square size in px (line icons used sparingly, §2). */
    size?: number;
  }

  let { name, size = 18 }: Props = $props();

  const PATHS: Record<Props["name"], string> = {
    // delete_outline — the quiet Toss glyph.
    toss: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    // edit — the pencil/stylus glyph.
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    // arrow_upward — the Push glyph.
    push: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
    // arrow_forward — the "See all notes" glyph.
    arrow: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z",
    // close — the sheet-dismiss X.
    close:
      "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    // delete (filled) — the destructive menu/modal glyph.
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    // drag_indicator — the six-dot reorder grip.
    grip: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
    // more_vert — the drawer row kebab.
    kebab:
      "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
>
  <path d={PATHS[name]} />
</svg>
