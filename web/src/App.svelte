<script lang="ts">
  /**
   * App shell (T16; sources: TASKS.md T16, DESIGN.md §5.1–5.6, DECISIONS.md
   * §3/§11). Exactly one view at a time, resolved by the view machine in
   * lib/view.ts over the server snapshot in lib/store.ts:
   * - no snapshot yet: the quiet T15 connecting placeholder;
   * - no stacks: FirstRunView alone, no chrome (§5.5) — entered and left only
   *   by server truth, never by navigation;
   * - otherwise: StackView always mounted as the desk, with at most one
   *   overlay sheet rendered on top (kept mounted so overlays slide over the
   *   desk — §5.3/§5.4 — and StackView's local state survives underneath).
   * Esc closes whatever overlay is open. Visual design starts with Phase 3
   * (T23+); this is mechanics with the least CSS that shows the layering.
   */
  import { snapshot, status } from "./lib/store";
  import { view, closeOverlay } from "./lib/view";
  import ArchiveView from "./views/ArchiveView.svelte";
  import FirstRunView from "./views/FirstRunView.svelte";
  import ListView from "./views/ListView.svelte";
  import StacksDrawer from "./views/StacksDrawer.svelte";
  import StackView from "./views/StackView.svelte";

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") closeOverlay();
    // Input-aware Esc for StackView's quick-add/edit inputs landed with T18:
    // those inputs handle and consume Escape themselves (clear draft /
    // cancel edit) and stopPropagation, so the window handler below only
    // sees Esc pressed outside an editing input. T33 owns the remaining
    // keyboard polish: `/` focuses the input, aria-live announcements, and
    // the full keyboard-only/axe pass.
    // The svelte:window keydown → closeOverlay() binding itself is exercised
    // by T22's Playwright e2e (approved plan); T16 verifies the machine
    // semantics via unit tests.
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $snapshot === null}
  {#if $status !== "online"}
    <main class="connecting"><p class="quiet">Connecting…</p></main>
  {:else}
    <main class="connecting"><p class="quiet">Waiting for the server snapshot…</p></main>
  {/if}
{:else if $view === "firstRun"}
  <FirstRunView />
{:else}
  <StackView />
  {#if $view === "list"}
    <ListView />
  {:else if $view === "drawer"}
    <StacksDrawer />
  {:else if $view === "archive"}
    <ArchiveView />
  {/if}
{/if}

{#if $snapshot !== null && $status !== "online"}
  <!-- Online-only app: be honest about disconnects wherever the user is,
       including inside an open overlay (fixed strip above the sheets).
       Tradeoff (T16): the strip is translucent and pointer-transparent so the
       Close/top-nav controls beneath stay usable with mouse and touch —
       bottom placement would collide with "See all N" and T28's pinned mobile
       input, and reserving conditional top space would couple body layout to
       a transient state. Phase 3 (T33) owns the real chrome/disconnect
       treatment; the T16 requirement is honesty without disabling controls. -->
  <p class="connection">
    {$status === "connecting"
      ? "Reaching for the server…"
      : "The server went quiet — picking the connection back up"}
  </p>
{/if}

<style>
  .connecting {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .quiet {
    /* Quiet ink is real copy (≥ WCAG AA) — var(--ink-muted) is the §2
       secondary-ink floor (#5a413b, darker than the old #555, so the floor
       holds a fortiori). */
    color: var(--ink-muted);
  }

  .connection {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20; /* above the overlay sheets (z-index 10 in app.css) */
    /* Clicks must pass through to the controls beneath (tradeoff above) —
     * an opaque blocking strip would disable Close and the top chrome. */
    pointer-events: none;
    margin: 0;
    padding: 0.25rem 0.5rem;
    text-align: center;
    /* Same quiet-ink/token note as .quiet above. */
    color: var(--ink-muted);
    /* The desk's warm surface at 90% over whatever sits beneath — a
     * translucent desk color via color-mix (evergreen-browsers only,
     * DECISIONS.md §11) instead of an rgba literal that would freeze the
     * old #f5f1e8 to a hex outside tokens.css. */
    background: color-mix(in srgb, var(--desk) 90%, transparent);
  }
</style>
