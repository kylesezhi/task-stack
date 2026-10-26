<script lang="ts">
  /**
   * ListView mechanics (T19; sources: TASKS.md T19, DESIGN.md §5.3,
   * DECISIONS.md §3/§4/§11) — the sheet over the desk: ordered rows of the
   * active stack's notes with drag-to-reorder, per-row edit and toss. The
   * header ("<stack> — N notes", Close, §5.3) and the .overlay chrome are
   * T16's, kept as built.
   *
   * -- Drag-to-reorder ------------------------------------------------------
   * Pointer Events, not HTML5 drag-and-drop: pointerdown on the row's
   * ⠿ handle starts a drag (preventDefault suppresses text selection and the
   * compatibility mouse-event stream), the WINDOW pointermove/pointerup/
   * pointercancel handlers on <svelte:window> drive it, and
   * `touch-action: none` on the handle keeps the gesture a drag (touch
   * polish is T28). Svelte owns these listeners' lifecycle — unmount removes
   * them — so if App.svelte's window-level Esc closes the overlay mid-drag,
   * the component unmounts and the drag dies with zero leaked listeners
   * (keyboard polish / drag-cancel-on-Esc is T33's; here Esc closing the
   * sheet mid-drag is accepted behavior). Listeners are NOT hand-rolled and
   * there is deliberately no onDestroy cleanup.
   *
   * Hit-testing is pure geometry: the pointer's clientY against the row
   * elements' CURRENT getBoundingClientRect(), re-measured per event (WS
   * updates can re-render rows mid-drag). No drag-follow: the dragged row
   * stays in its slot with a `.dragging` class, the current drop target
   * gets a `.drop-target` highlight; transforms tracking the pointer and
   * the paper visuals are T32.
   *
   * Commits are guarded one-at-a-time: by the time a reorder PUT starts, the
   * drag is already ended (pointerup clears draggedId/dropTargetId before
   * setting `committing`), so during the flight the window handlers are
   * inert — further pointerup commits are no-ops and new drags are blocked
   * by `committing`; stale id sets can never race each other. On
   * {ok:false} (e.g. a remote mutation made the id set stale → server 400)
   * one quiet role="alert" line explains; drag state is always cleared when
   * a drag ends, success or not. Accepted edge for v1: no cross-action
   * serialization — while a reorder PUT is in flight, edit/toss stay
   * enabled, and an overlap can 400 on the stale id set (single-user,
   * millisecond-local mutations; the quiet error line explains — the same
   * vanishing-conflict stance as StackView's remote-edit auto-cancel,
   * DECISIONS.md §4/§5).
   *
   * All failure feedback shares ONE actionError state rendered as the single
   * quiet role="alert" line. It is cleared at the start of each reorder /
   * edit-save / toss action and set to the latest result.error — one sheet,
   * one line, most-recent failure wins. Deliberately NOT cleared by edit
   * cancel or auto-cancel, which differs from StackView's per-surface error
   * states (pushError/actionError/editError, with cancelEdit clearing).
   *
   * The empty state's copy is reachable by tossing the last notes from
   * within the sheet itself, or by a remote mutation emptying the stack
   * while the sheet is open — but never by OPENING it with zero notes, since
   * StackView's "See all N" footer renders only when N > 0.
   *
   * -- Edit / toss ----------------------------------------------------------
   * Mirrors StackView's inline edit exactly (error handling aside — see
   * above): one editingId at a time, draft
   * + Save/Cancel, Esc consumed on the input (stopPropagation — App's
   * window Esc must not also close the sheet), keep-draft-on-failure,
   * auto-cancel via $effect when the note vanishes from the snapshot, close
   * only if the draft still matches what was saved. The input id is
   * `list-note-text` (NOT StackView's `note-text`): StackView stays mounted
   * beneath this sheet, so a duplicate id would be invalid HTML. Row toss
   * guards per row, and the row disappears via the snapshot — no manual
   * removal code (the snapshot drives the UI; DECISIONS.md §11).
   */
  import { snapshot, editNote, reorderNotes, tossNote } from "../lib/store";
  import { closeOverlay } from "../lib/view";
  import { reorderNoteIds } from "../lib/reorder";
  import { NOTE_TEXT_MAX_LENGTH } from "@task-stack/shared";

  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  // Defensive ?? "unknown" / ?? null: a view must never crash on a missing
  // row (the view machine already flipped to firstRun if the stack vanished,
  // so this is just a transient-frame guard).
  const activeStack = $derived(
    $snapshot?.stacks.find((stack) => stack.id === activeStackId) ?? null,
  );
  // Filter FIRST (copies the snapshot array), then sort the copy — never
  // sort the snapshot in place. Server truth: position-ascending, 1 = top.
  const stackNotes = $derived(
    ($snapshot?.notes ?? [])
      .filter((note) => note.stackId === activeStackId)
      .sort((a, b) => a.position - b.position),
  );

  // -- Drag-to-reorder ------------------------------------------------------
  let draggedId = $state<string | null>(null);
  let dropTargetId = $state<string | null>(null);
  let committing = $state(false);
  // ONE shared failure line for every action (reorder / edit / toss),
  // cleared at the start of each action — the line always shows the most
  // recent failure, never a stale one masking a newer one.
  let actionError = $state<string | null>(null);
  /** Row elements by note id, for geometry hit-testing. Bound per row;
   * entries die with their {#each} iteration, so nothing leaks. */
  let rowNodes = $state<Record<string, HTMLElement | null>>({});

  function startDrag(event: PointerEvent, rowId: string): void {
    // Primary-button left contact only (touch/pen primary reports button 0,
    // so nothing legitimate is excluded); a right-click starts nothing.
    if (event.button !== 0 || !event.isPrimary) return;
    if (draggedId !== null || committing) return;
    // Suppress text selection / compatibility mouse events for the gesture.
    event.preventDefault();
    // Capture the pointer on the handle: a mouse pointerup released OUTSIDE
    // the browser window is otherwise never delivered, leaving the drag
    // stuck (the next pointerup anywhere could commit a stray reorder).
    // Captured events retarget to the handle but still bubble to the
    // <svelte:window> handlers, and clientX/Y stay global — hit-testing is
    // unchanged. pointerup/pointercancel release the capture implicitly (no
    // manual releasePointerCapture).
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    draggedId = rowId;
    dropTargetId = rowId;
    actionError = null;
  }

  /** Geometry hit-test: the drop target is whatever row the pointer is
   * vertically inside, re-measured per event (rows can re-render mid-drag
   * under a WS update; cached rects would go stale). */
  function hitTest(pointerY: number): string | null {
    for (const note of stackNotes) {
      const row = rowNodes[note.id] ?? null;
      if (row === null) continue;
      const rect = row.getBoundingClientRect();
      if (pointerY >= rect.top && pointerY < rect.bottom) return note.id;
    }
    return null;
  }

  function onPointerMove(event: PointerEvent): void {
    if (draggedId === null) return;
    dropTargetId = hitTest(event.clientY);
  }

  async function onPointerUp(event: PointerEvent): Promise<void> {
    if (draggedId === null) return;
    const target = hitTest(event.clientY);
    // End the drag FIRST, whatever happens below; `dragged` is frozen here so
    // the commit never mixes pre- and post-update drag state.
    const dragged = draggedId;
    draggedId = null;
    dropTargetId = null;
    if (committing || activeStackId === null) return; // one reorder commit at a time
    const currentIds = stackNotes.map((note) => note.id);
    const newIds = reorderNoteIds(currentIds, dragged, target ?? dragged);
    if (target === null || newIds.join("\u0000") === currentIds.join("\u0000")) {
      actionError = null; // silent no-op: released outside any row / no change
      return;
    }
    committing = true;
    actionError = null;
    const result = await reorderNotes(activeStackId, newIds);
    if (!result.ok) actionError = result.error;
    committing = false; // the fresh snapshot (ok or not) re-renders the rows
  }

  /** Abort: highlight dies, nothing commits. Fires when the OS/browser
   * cancels the gesture (touch takeover, browser UI interception); it does
   * NOT reliably fire for a mouse release outside the window — that path is
   * covered by the handle's pointer capture delivering pointerup. */
  function onPointerCancel(): void {
    draggedId = null;
    dropTargetId = null;
  }

  // -- Inline edit (StackView T18's pattern, one editingId) -----------------
  let editingId = $state<string | null>(null);
  let editDraft = $state("");
  let saving = $state(false);
  const editTrimmed = $derived(editDraft.trim());
  const canSave = $derived(editTrimmed.length > 0 && !saving);

  function startEdit(rowId: string, text: string): void {
    if (draggedId !== null || editingId !== null) return;
    editingId = rowId;
    editDraft = text;
    actionError = null;
  }

  function cancelEdit(): void {
    editingId = null;
    editDraft = "";
    saving = false;
  }

  async function onEditSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (editingId === null || !canSave) return;
    saving = true;
    actionError = null;
    const sent = editTrimmed;
    const result = await editNote(editingId, sent);
    if (result.ok) {
      // Close only if the draft still matches what was saved — typing ahead
      // keeps the form open with the typed-ahead draft (no silent loss).
      if (editDraft.trim() === sent) cancelEdit();
      else saving = false;
    } else {
      // Keep the draft for the retry.
      actionError = result.error;
      saving = false;
    }
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    cancelEdit();
    // Fully consumed: App.svelte's window Esc (overlay close) must not also
    // fire for the same keypress.
    event.stopPropagation();
  }

  /** Focuses the node when it mounts — the input appears when edit opens.
   *  Deliberately NO select(): with no undo (DECISIONS.md §4), select-all
   *  plus one stray keystroke would wipe the note's text. */
  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  // Auto-cancel when the note under edit leaves the snapshot: a remote
  // mutation (WS) tossed/completed it. Draft loss accepted (vanishing-conflict
  // edge already covered by DECISIONS.md §4/§5).
  $effect(() => {
    if (editingId !== null && !stackNotes.some((note) => note.id === editingId)) {
      cancelEdit();
    }
  });

  // -- Toss (per-row in-flight guard) ---------------------------------------
  let tossingId = $state<string | null>(null);

  async function onToss(rowId: string): Promise<void> {
    if (tossingId !== null || draggedId !== null) return;
    tossingId = rowId;
    actionError = null;
    const result = await tossNote(rowId);
    if (!result.ok) actionError = result.error;
    tossingId = null; // the row vanishes via the snapshot, no manual removal
  }
</script>

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
/>

<section class="overlay">
  <header>
    <h2>
      {activeStack?.name ?? "unknown"} — {stackNotes.length}
      {stackNotes.length === 1 ? "note" : "notes"}
    </h2>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
    {#if stackNotes.length === 0}
      <!-- DESIGN.md §5.3's empty-list copy; reachable by tossing the last
           notes from within the sheet itself, or by a remote mutation
           emptying the stack while the sheet is open — but never by OPENING
           it with zero notes, since StackView's "See all N" footer renders
           only when N > 0. -->
      <p class="empty">Nothing buried. Lucky you.</p>
    {:else}
      <ol class="rows">
        {#each stackNotes as note (note.id)}
          <li
            class="row"
            class:dragging={draggedId === note.id}
            class:drop-target={dropTargetId === note.id}
            bind:this={rowNodes[note.id]}
          >
            {#if editingId === note.id}
              <form class="edit" onsubmit={onEditSubmit}>
                <label class="visually-hidden" for="list-note-text">Note text</label>
                <input
                  id="list-note-text"
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
            {:else}
              <button
                type="button"
                class="handle"
                aria-label="Drag to reorder"
                onpointerdown={(event) => startDrag(event, note.id)}
              >
                ⠿
              </button>
              <span class="note-text">{note.text}</span>
              <span class="row-actions">
                <button
                  type="button"
                  class="row-action"
                  onclick={() => startEdit(note.id, note.text)}
                  disabled={draggedId !== null}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="row-action"
                  onclick={() => onToss(note.id)}
                  disabled={tossingId !== null || draggedId !== null}
                >
                  Toss
                </button>
              </span>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if actionError !== null}
      <p class="error" role="alert">{actionError}</p>
    {/if}
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
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  /* Minimal readable rows — the paper look is T32. */
  .rows {
    width: 100%;
    max-width: 28rem;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ddd;
  }

  /* Subtle in-place marker only: the row does NOT follow the pointer (no
     transforms — drag-follow and paper visuals are T32's). */
  .row.dragging {
    opacity: 0.5;
  }

  /* Highlight of the current drop target (pure-geometry hit-test). */
  .row.drop-target {
    border-color: #555;
  }

  .handle {
    /* `touch-action: none`: a touch drag is a drag, not a scroll (T28). */
    touch-action: none;
    cursor: grab;
    background: none;
    border: none;
    color: #555;
    padding: 0 0.25rem;
  }

  .note-text {
    flex: 1;
    min-width: 0;
  }

  .row-actions {
    display: flex;
    gap: 0.25rem;
  }

  .row-actions button {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
  }

  .row-actions button:disabled {
    cursor: default;
    color: #777;
  }

  .edit {
    flex: 1;
    display: flex;
    gap: 0.5rem;
  }

  .empty {
    /* #555 not #999: real copy's quiet-ink floor (StackView precedent — */
    /* #999 on white is ~2.85:1, below WCAG AA). */
    color: #555;
    font-size: 0.9rem;
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
    /* #555 (not #999): the only failure feedback must stay above WCAG AA. */
    color: #555;
    font-size: 0.9rem;
  }
</style>
