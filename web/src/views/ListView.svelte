<script lang="ts">
  /**
   * ListView placeholder (T16; DESIGN.md §5.3) — a sheet over the desk with
   * real Close wiring; the rows (drag-to-reorder, edit, toss) arrive with
   * T19. Note COUNT is live (server truth); contents are a placeholder.
   */
  import { snapshot } from "../lib/store";
  import { closeOverlay } from "../lib/view";

  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  const noteCount = $derived(
    $snapshot?.notes.filter((note) => note.stackId === activeStackId).length ?? 0,
  );
</script>

<section class="overlay">
  <header>
    <h2>{activeStack?.name ?? "unknown"} — {noteCount} {noteCount === 1 ? "note" : "notes"}</h2>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
    <p class="placeholder">The readable rows arrive with T19.</p>
  </div>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .body {
    flex: 1;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .placeholder {
    color: #999;
    font-size: 0.9rem;
  }
</style>
