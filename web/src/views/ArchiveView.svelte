<script lang="ts">
  /**
   * ArchiveView placeholder (T16; DESIGN.md §5.6) — a quiet top sheet with
   * the live completed count and real Close wiring; the day groups, stack
   * chips, and times arrive with T21.
   */
  import { snapshot } from "../lib/store";
  import { closeOverlay } from "../lib/view";

  const doneCount = $derived($snapshot?.completed.length ?? 0);
</script>

<section class="overlay">
  <header>
    <h2>Archive</h2>
    <p class="done">{doneCount} done</p>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
    <p class="placeholder">Day groups arrive with T21.</p>
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
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .done {
    margin: 0;
    color: #777;
  }

  header button {
    margin-left: auto;
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
