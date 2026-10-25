<script lang="ts">
  /**
   * StackView placeholder (T16; DESIGN.md §5.1) — the desk. Top chrome wired
   * live to the view machine (Stacks / Archive buttons, active-stack name +
   * note count, "See all N" link when there is anything to see); the stack
   * itself (top note, edges, quick-add) arrives with T18/T25/T26, so the
   * center stage is a placeholder. Always mounted underneath overlays so an
   * open sheet keeps the desk intact beneath it.
   */
  import { snapshot } from "../lib/store";
  import { openView } from "../lib/view";

  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  // Defensive ?? "unknown": the server invariant keeps the row findable, but
  // a view must never crash on a missing row.
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  const noteCount = $derived(
    $snapshot?.notes.filter((note) => note.stackId === activeStackId).length ?? 0,
  );
</script>

<div class="desk">
  <header class="chrome">
    <button type="button" onclick={() => openView("drawer")}>Stacks</button>
    <p class="title">
      {activeStack?.name ?? "unknown"}
      <span class="count"> {noteCount} {noteCount === 1 ? "note" : "notes"} </span>
    </p>
    <button type="button" onclick={() => openView("archive")}>Archive</button>
  </header>

  <main class="stage">
    <p class="placeholder">The stack itself arrives with T18.</p>
  </main>

  {#if noteCount > 0}
    <footer class="below">
      <button type="button" class="link" onclick={() => openView("list")}>
        See all {noteCount}
      </button>
    </footer>
  {/if}
</div>

<style>
  .desk {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .chrome {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title {
    margin: 0;
  }

  .count {
    color: #777;
    font-size: 0.9rem;
    /* span inside p: swallow the whitespace the {#text} interpolation adds */
    /* (kept minimal; Phase 3 owns real chrome styling) */
    white-space: nowrap;
  }

  .stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .placeholder {
    color: #bbb;
    font-size: 0.9rem;
  }

  .below {
    display: flex;
    justify-content: center;
  }

  .link {
    border: none;
    background: none;
    text-decoration: underline;
    color: #555;
    cursor: pointer;
  }
</style>
