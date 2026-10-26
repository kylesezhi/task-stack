<script lang="ts">
  /**
   * StackView mechanics (T18; sources: TASKS.md T18, DESIGN.md §3/§5.1/§6) —
   * the desk: top note card, Done / Edit / Toss action row, "See all N"
   * footer, quick-add form, empty-stack line. Chrome (T16) and the "See all"
   * wiring stay as built; the placeholder stage is replaced by the real
   * mechanics. Peek edges / card visuals / ceremony arrive with T25–T27,
   * the ghost-outline empty state's visuals with T31.
   *
   * Mutations go through the store helpers (T15), each resolving
   * `{ok:true} | {ok:false; error}` — never rejecting. On success the fresher
   * server snapshot is applied before the promise resolves, so there is
   * deliberately NO navigation or re-render code after a mutation: the
   * snapshot drives the UI. On failure the typed text/kept draft stays and
   * one quiet role="alert" line explains (§6 register: no exclamations).
   *
   * Esc inside the inputs is input-aware and fully consumed on the input
   * (quick-add: clear text if any; edit: cancel) via stopPropagation, so
   * App.svelte's svelte:window Esc (closes overlays) never double-fires.
   */
  import { snapshot, completeNote, editNote, pushNote, tossNote } from "../lib/store";
  import { openView } from "../lib/view";
  import { NOTE_TEXT_MAX_LENGTH } from "@task-stack/shared";

  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  // Defensive ?? "unknown": the server invariant keeps the row findable, but
  // a view must never crash on a missing row.
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  const noteCount = $derived(
    $snapshot?.notes.filter((note) => note.stackId === activeStackId).length ?? 0,
  );
  // Filter FIRST (it copies the snapshot array), then sort the copy —
  // never sort the snapshot in place. Server truth: position-ascending
  // within a stack, 1 = top.
  const stackNotes = $derived(
    ($snapshot?.notes ?? [])
      .filter((note) => note.stackId === activeStackId)
      .sort((a, b) => a.position - b.position),
  );
  const topNote = $derived(stackNotes[0] ?? null);

  // -- Quick-add -----------------------------------------------------------
  let draft = $state("");
  let pushing = $state(false);
  let pushError = $state<string | null>(null);
  // Same trim the server applies (shared/src/validation.ts mirrors it) — a
  // broken push can only come from a length/type violation, never whitespace.
  const trimmed = $derived(draft.trim());
  const canPush = $derived(trimmed.length > 0 && !pushing);

  async function onQuickAddSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (activeStackId === null || !canPush) return; // Enter submits even when disabled
    pushing = true;
    pushError = null;
    const sent = trimmed;
    const result = await pushNote(activeStackId, sent);
    if (result.ok) {
      // Clear the draft only if nothing was typed during the flight — typing
      // ahead keeps the draft so the next note continues (in-flight windows
      // are short but not zero; silently eating typed text would feel
      // broken). The pushed note is on top via server truth either way.
      if (draft.trim() === sent) draft = "";
      pushing = false;
    } else {
      // `draft` is untouched — the user keeps what they typed for the retry.
      pushError = result.error;
      pushing = false;
    }
  }

  function onQuickAddKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (draft !== "") {
      // Input-internal Esc is fully consumed by the input: clear the draft
      // and keep App.svelte's window-level Esc (overlay close) out.
      draft = "";
      event.stopPropagation();
    }
    // Already empty → let it bubble (on the desk that's a no-op anyway).
  }

  // -- Action row: Done / Toss ---------------------------------------------
  let acting = $state<"done" | "toss" | null>(null);
  let actionError = $state<string | null>(null);

  async function onDone(): Promise<void> {
    if (topNote === null || acting !== null) return;
    acting = "done";
    actionError = null;
    const result = await completeNote(topNote.id);
    if (!result.ok) actionError = result.error;
    acting = null;
  }

  async function onToss(): Promise<void> {
    if (topNote === null || acting !== null) return;
    acting = "toss";
    actionError = null;
    const result = await tossNote(topNote.id);
    if (!result.ok) actionError = result.error;
    acting = null;
  }

  // -- Inline edit -----------------------------------------------------------
  let editingId = $state<string | null>(null);
  let editDraft = $state("");
  let saving = $state(false);
  let editError = $state<string | null>(null);
  const editTrimmed = $derived(editDraft.trim());
  const canSave = $derived(editTrimmed.length > 0 && !saving);

  function startEdit(): void {
    if (topNote === null || editingId !== null) return;
    editingId = topNote.id;
    editDraft = topNote.text;
    editError = null;
  }

  function cancelEdit(): void {
    editingId = null;
    editDraft = "";
    saving = false;
    editError = null;
  }

  async function onEditSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (editingId === null || !canSave) return;
    saving = true;
    editError = null;
    const sent = editTrimmed;
    const result = await editNote(editingId, sent);
    if (result.ok) {
      // Close the form only if the draft still matches what was saved —
      // typing ahead keeps the form open with the typed-ahead draft visible
      // (no silent loss; the user finishes and saves again). Server truth
      // already applied `sent`.
      if (editDraft.trim() === sent) {
        cancelEdit();
      } else {
        saving = false;
      }
    } else {
      // Stay in edit mode; keep the draft for the retry.
      editError = result.error;
      saving = false;
    }
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    cancelEdit();
    event.stopPropagation();
  }

  /** Focuses the node when it mounts — the edit input appears exactly
   *  when edit mode opens. Action (not `$effect`): the element is created
   *  with the form. Deliberately NO select(): with no undo (DECISIONS.md
   *  §4), select-all plus one stray keystroke would wipe the note's text. */
  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  // Auto-close when the note under edit leaves the top slot: a remote
  // mutation (WS) completed/tossed/reordered it away from position 1. Draft
  // loss is accepted — single-user app, and this is the vanishing-conflict
  // edge the no-undo decision (DECISIONS.md §4/§5) already covers.
  $effect(() => {
    if (editingId !== null && editingId !== (topNote?.id ?? null)) {
      cancelEdit();
    }
  });
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

  <!-- The document's only <main> (sheets are dialogs, not mains — T16 rule). -->
  <main class="stage">
    {#if topNote !== null}
      {#if editingId === topNote.id}
        <form class="edit" onsubmit={onEditSubmit}>
          <label class="visually-hidden" for="note-text">Note text</label>
          <input
            id="note-text"
            type="text"
            bind:value={editDraft}
            maxlength={NOTE_TEXT_MAX_LENGTH}
            autocomplete="off"
            onkeydown={onEditKeydown}
            use:focusOnMount
          />
          <button type="submit" disabled={!canSave}>Save</button>
          <button type="button" onclick={cancelEdit}>Cancel</button>
        </form>
        {#if editError !== null}
          <p class="error" role="alert">{editError}</p>
        {/if}
      {:else}
        <p class="note-text">{topNote.text}</p>
      {/if}
    {:else}
      <!-- Quiet empty state (§5.1); the ghost-outline visual is T31. -->
      <p class="empty">The stack is empty.</p>
    {/if}
  </main>

  {#if topNote !== null}
    <!-- Done primary, Edit ghost, Toss quietest ghost (§5.1) — solid vs plain
         vs muted ink; Phase 3 owns the real styling. Both Done and Toss are
         disabled while one is in flight: on a success mid-flight the top
         note CHANGES, so a second click would complete/toss the note
         revealed beneath (a double-pop); on a failure it would blindly
         retry. The guard makes one action one click. -->
    <div class="actions">
      <button type="button" class="done" onclick={onDone} disabled={acting !== null}> Done </button>
      <button type="button" class="edit" onclick={startEdit} disabled={acting !== null}>
        Edit
      </button>
      <button type="button" class="toss" onclick={onToss} disabled={acting !== null}> Toss </button>
    </div>
    {#if actionError !== null}
      <p class="error" role="alert">{actionError}</p>
    {/if}
  {/if}

  {#if noteCount > 0}
    <footer class="below">
      <button type="button" class="link" onclick={() => openView("list")}>
        See all {noteCount}
      </button>
    </footer>
  {/if}

  <!-- Always rendered: pushing onto an empty stack is the primary flow after
       first run. No "/ to focus" hint yet — the shortcut is T33's wiring, and
       advertising it now would be a lie (§6 honesty). -->
  <section class="quick-add">
    <form onsubmit={onQuickAddSubmit}>
      <label class="visually-hidden" for="quick-add">New note</label>
      <input
        id="quick-add"
        type="text"
        bind:value={draft}
        maxlength={NOTE_TEXT_MAX_LENGTH}
        autocomplete="off"
        placeholder="Write it down, stick it on top."
        onkeydown={onQuickAddKeydown}
      />
      <button type="submit" disabled={!canPush}>Push</button>
    </form>
    {#if pushError !== null}
      <p class="error" role="alert">{pushError}</p>
    {/if}
  </section>
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
    gap: 0.75rem;
  }

  /* Minimal readable top note — paper card + tilt are T25/T26. */
  .note-text {
    font-size: 1.5rem;
  }

  .empty {
    /* #555 not #999: real copy's quiet-ink floor (FirstRunView precedent —
       #999 on white is ~2.85:1, below WCAG AA; Phase 3 tokens restyle anyway). */
    color: #555;
    font-size: 0.9rem;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .actions button {
    cursor: pointer;
  }

  .done {
    /* solid background = the one primary (§5.1); real color is Phase 3. */
    background: #444;
    color: #fff;
    border: none;
  }

  .edit {
    background: none;
    border: none;
  }

  .toss {
    background: none;
    border: none;
    color: #888;
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

  .quick-add {
    display: flex;
    justify-content: center;
  }

  .quick-add form {
    display: flex;
    gap: 0.5rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .error {
    margin: 0;
    text-align: center;
    /* #555 (not #999): this is the ONLY failure feedback, and #999 on white
       is ~2.85:1 — below WCAG AA. Same quiet ink as FirstRunView's. */
    color: #555;
    font-size: 0.9rem;
  }
</style>
