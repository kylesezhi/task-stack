<script lang="ts">
  /**
   * StacksDrawer placeholder (T16; DESIGN.md §5.4) — a read-only sheet over
   * the desk: every stack with its note count, the active one marked. The
   * kebab actions (create / rename / delete / switch) arrive with T20 —
   * deliberately NOT stubbed: T16 adds no functional CRUD.
   */
  import { snapshot } from "../lib/store";
  import { closeOverlay } from "../lib/view";

  const stacks = $derived($snapshot?.stacks ?? []);
</script>

<section class="overlay">
  <header>
    <h2>Stacks</h2>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
    {#if stacks.length === 0}
      <p class="placeholder">No stacks yet — the create form arrives with T20.</p>
    {:else}
      <ul>
        {#each stacks as stack (stack.id)}
          {@const count = $snapshot?.notes.filter((note) => note.stackId === stack.id).length ?? 0}
          <li>
            {stack.name} ({count})
            {#if stack.id === $snapshot?.activeStackId}
              <span class="active">— active</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <p class="footer">Create, rename, and delete arrive with T20.</p>
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
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .active {
    color: #555;
    font-size: 0.9rem;
  }

  .placeholder,
  .footer {
    color: #999;
    font-size: 0.9rem;
  }
</style>
