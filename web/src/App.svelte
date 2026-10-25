<script lang="ts">
  /**
   * T15 smoke surface — temporary by design; replaced by the real T16/T18
   * views. It proves the state client end to end (connect, snapshot, push
   * mutation) and intentionally does NO design work (Phase 3 owns visuals).
   */
  import { NOTE_TEXT_MAX_LENGTH } from "@task-stack/shared";
  import { pushNote, snapshot, status } from "./lib/store";

  let text = $state("");
  /** Last mutation failure, shown inline; cleared on the next attempt. */
  let pushError: string | null = $state(null);

  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  // Snapshot notes are ordered position-ascending (1 = top), so index 0 is
  // the top note of the active stack.
  const activeNotes = $derived(
    $snapshot?.notes.filter((note) => note.stackId === activeStackId) ?? [],
  );
  const topNote = $derived(activeNotes[0] ?? null);

  async function onPush(event: SubmitEvent): Promise<void> {
    event.preventDefault(); // a form submit must not reload the page
    const stackId = activeStackId;
    if (stackId === null || text.trim() === "") return; // mirrored in the disabled state below
    pushError = null;
    const result = await pushNote(stackId, text);
    if (result.ok) {
      text = ""; // clear only on success so a failed push keeps its text
    } else {
      pushError = result.error;
    }
  }
</script>

<main>
  <h1>task-stack</h1>
  <p class="status">Status: {$status}</p>

  {#if $snapshot === null}
    {#if $status !== "online"}
      <p class="quiet">Connecting…</p>
    {:else}
      <p class="quiet">Waiting for the server snapshot…</p>
    {/if}
  {:else}
    {@const snap = $snapshot}
    <section>
      <p>
        Active stack:
        {snap.activeStackId === null ? "no stacks yet" : (activeStack?.name ?? "unknown")}
      </p>
      <ul>
        {#each snap.stacks as stack (stack.id)}
          {@const count = snap.notes.filter((note) => note.stackId === stack.id).length}
          <li>{stack.name} — {count} {count === 1 ? "note" : "notes"}</li>
        {/each}
      </ul>
      {#if topNote}
        <p>Top note: {topNote.text}</p>
      {/if}
      <p>Completed: {snap.completed.length}</p>

      <form onsubmit={onPush}>
        <input
          bind:value={text}
          maxlength={NOTE_TEXT_MAX_LENGTH}
          placeholder="Push a note onto the stack…"
          aria-label="New note text"
        />
        <button type="submit" disabled={activeStackId === null || text.trim() === ""}>
          Push
        </button>
      </form>
      {#if pushError}
        <p class="error">{pushError}</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-family: system-ui, sans-serif;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .status,
  .quiet,
  .error {
    margin: 0;
    color: #555;
  }

  .error {
    color: #a33;
  }

  form {
    display: flex;
    gap: 0.5rem;
  }
</style>
