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
   *
   * T33 slice 1 lands the a11y foundations: ONE global polite live region
   * (lib/announce.ts) rendered here — OUTSIDE the inert desk wrapper below
   * so it still announces while a sheet is open — narrating top-note
   * changes via lib/top-announcement.ts. The desk itself goes `inert`
   * whenever an overlay is on top — but stays MOUNTED (§5.3/§5.4): a
   * conditional would remount StackView and reset its trackers and local
   * state; `inert` takes the desk out of Tab order and AT while a sheet
   * is up.
   */
  import { snapshot, status } from "./lib/store";
  import { view, closeOverlay } from "./lib/view";
  import { announce, announcement } from "./lib/announce";
  import { topNoteAnnouncement } from "./lib/top-announcement";
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
    // sees Esc pressed outside an editing input. T33's remaining keyboard
    // polish has landed too: `/` focuses quick-add, one global live region
    // narrates top-note changes, and the zz-a11y keyboard-only/axe e2e
    // exercises the whole desk end to end.
    // The svelte:window keydown → closeOverlay() binding itself is exercised
    // by T22's Playwright e2e (approved plan); T16 verifies the machine
    // semantics via unit tests.
  }

  // -- aria-live: announce top-note changes (T33) ---------------------------
  // Same filter-then-sort discipline as StackView (never sort the snapshot
  // in place): position-ascending copy of the active stack's notes, so
  // index 0 is what sits on top.
  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  const activeNotes = $derived(
    ($snapshot?.notes ?? [])
      .filter((note) => note.stackId === activeStackId)
      .sort((a, b) => a.position - b.position),
  );

  // Plain (non-reactive) bookkeeping — deliberately NOT $state: they are
  // write-only side notes of this effect, never read by the template, so
  // tracking them would only cause useless re-runs.
  let announcedFirst = false;
  let announcedKey: string | null = null;

  $effect(() => {
    const stack = activeStack;
    const notes = activeNotes;
    if (stack === null) return; // first run: no desk to narrate yet
    // The key is stack + top id, NOT count, name, or text: a stack rename
    // or an edit of the top note (same id) changes none of those and must
    // stay silent. A buried-row toss changes only the COUNT, not the top
    // note, so it must stay silent too (the count tail of the key is gone —
    // it used to re-narrate the same top note); every real top change
    // (push / pop / toss-top / reorder / switch) changes the top id and
    // speaks. The very first observation is skipped: landing on the desk
    // after a reload is not news worth narrating.
    const key = `${stack.id}:${notes[0]?.id ?? ""}`;
    if (!announcedFirst) {
      announcedFirst = true;
      announcedKey = key;
      return;
    }
    if (key === announcedKey) return;
    announcedKey = key;
    announce(topNoteAnnouncement(stack.name, notes));
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if $snapshot === null}
  {#if $status !== "online"}
    <main class="connecting"><p class="quiet">Connecting…</p></main>
  {:else}
    <main class="connecting"><p class="quiet">Waking the desk…</p></main>
  {/if}
{:else if $view === "firstRun"}
  <FirstRunView />
{:else}
  <!-- T33: inert (not an {#if}) while an overlay is open — the attribute
       takes the desk out of Tab order and AT without UNMOUNTING StackView,
       whose trackers and local state must survive underneath (§5.3/§5.4).
       The live region below and the connection strip stay outside this
       wrapper so they still announce/report while a sheet is up. -->
  <div inert={$view !== "stack"}>
    <StackView />
  </div>
  {#if $view === "list"}
    <ListView />
  {:else if $view === "drawer"}
    <StacksDrawer />
  {:else if $view === "archive"}
    <ArchiveView />
  {/if}
{/if}

<!-- The one global polite live region (T33): visually hidden, outside the
     inert desk wrapper, aria-atomic so each announcement is spoken whole.
     Components call announce(); they never render their own regions. -->
<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
  {$announcement}
</div>

{#if $snapshot !== null && $status !== "online"}
  <!-- Online-only app: be honest about disconnects wherever the user is,
       including inside an open overlay (fixed strip above the sheets).
       Tradeoff (T16): the strip is translucent and pointer-transparent so the
       Close/top-nav controls beneath stay usable with mouse and touch —
       bottom placement would collide with "See all N" and T28's pinned mobile
       input, and reserving conditional top space would couple body layout to
       a transient state. The treatment is T16's, as shipped (honesty without
       disabling controls), and the T33 a11y pass left this strip unchanged. -->
  <p class="connection">
    {$status === "connecting"
      ? "Reaching for the server…"
      : "The server went quiet — picking the connection back up"}
  </p>
{/if}

<style>
  .connecting {
    /* T28 dvh cascade (DECISIONS.md §11 evergreen-only): 100vh first, then
       100dvh so a collapsing mobile URL bar is honored honestly. */
    min-height: 100vh; /* pre-dvh fallback */
    min-height: 100dvh; /* evergreen dynamic viewport (DECISIONS.md §11) */
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

  /* The T33 live region's only styling: off-screen for sighted users, fully
     readable by AT (same shape as StackView's label class — clip, not
     opacity, so screen readers still get the text). */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .connection {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20; /* above the overlay sheets (z-index 10, web/src/sheets.css) */
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
