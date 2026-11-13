<script lang="ts">
  /**
   * ListView (T19 mechanics + T32 sheet polish; sources: TASKS.md T19/T32,
   * DESIGN.md §5.3/§7, DECISIONS.md §3/§4/§11) — the paper sheet over the
   * desk: ordered rows of the active stack's notes with drag-to-reorder,
   * per-row edit and toss. The T32 layer (web/src/sheets.css) turns the old
   * T16 mechanics shell into the shared sheet language: a scrim `.overlay`
   * + a `.sheet` paper rectangle, the sheet sliding in/out via
   * lib/sheet-motion (§7 "paper sheets slide"; reduced motion → fade).
   *
   * -- Drag-to-reorder ------------------------------------------------------
   * Pointer Events, not HTML5 drag-and-drop: pointerdown on the row's ⠿
   * handle starts a drag (preventDefault suppresses text selection and the
   * compatibility mouse-event stream), the WINDOW pointermove/pointerup/
   * pointercancel handlers on <svelte:window> drive it, and
   * `touch-action: none` on the handle keeps the gesture a drag. Svelte
   * owns these listeners' lifecycle — unmount removes them — so if
   * App.svelte's window-level Esc closes the overlay mid-drag, the
   * component unmounts and the drag dies with zero leaked listeners
   * (keyboard polish / drag-cancel-on-Esc is T33's; here Esc closing the
   * sheet mid-drag is accepted behavior). Listeners are NOT hand-rolled and
   * there is deliberately no onDestroy cleanup.
   *
   * Hit-testing is pure geometry: the pointer's clientY against the row
   * elements' CURRENT getBoundingClientRect(), re-measured per event (WS
   * updates can re-render rows mid-drag). NO DRAG-FOLLOW — this is the
   * delivered T32 choice, not a deferred TODO: hit-testing reads the live
   * row rects, so a row translated under the pointer would move the
   * geometry it is being hit-tested against and corrupt the very slot it
   * is dropped into. Instead the dragged row lifts IN PLACE (`.dragging`
   * raises it out of the list's paper rhythm with an edge highlight) and
   * the current drop target gets the quiet accent inset rail (`.drop-
   * target`) — quiet, no layout shift, honest hit-testing.
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
   *
   * -- Row actions (T32) ----------------------------------------------------
   * The per-row Edit/Toss controls are quiet ghost icon buttons (pencil / ×)
   * with aria-labels carrying the accessible names — the tests locate them
   * by role + name, not by visible text. They are revealed by row
   * hover/focus-within via OPACITY on hover-capable desktop (never
   * display:none — that would drop them from the tab order), and are always
   * visible at ≤640px or on non-hover devices (§5.3 "small quiet row actions
   * on hover/focus").
   */
  import { fade } from "svelte/transition";
  import { snapshot, editNote, reorderNotes, tossNote } from "../lib/store";
  import { closeOverlay } from "../lib/view";
  import { reorderNoteIds } from "../lib/reorder";
  import { NOTE_TEXT_MAX_LENGTH } from "@task-stack/shared";
  import { sheetIn, sheetOut } from "../lib/sheet-motion";

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

<!-- The scrim fades in only (`in:fade`, a plain 160ms — a backdrop veil needs
     no shared clock, and a fade is already the reduced-motion-safe shape).
     Intro-only matters: an intro transition's out() is a no-op, so the
     overlay is never marked inert; the still-mounted scrim keeps blocking
     desk input until the sheet's outro finishes and the block is removed,
     while the sheet subtree itself is inert during its slide-out. The SHEET
     slides (lib/sheet-motion: --motion-sheet, fade under reduced motion). -->
<div class="overlay" in:fade={{ duration: 160 }}>
  <section class="sheet" in:sheetIn={{ y: 20 }} out:sheetOut={{ y: 12 }}>
    <header class="sheet-header">
      <!-- The accessible name stays "<stack> — N notes" (e2e asserts it);
           the count tail is a .sheet-count span for the quiet label look. -->
      <h2 class="sheet-heading">
        {activeStack?.name ?? "unknown"} —
        <span class="sheet-count"
          >{stackNotes.length} {stackNotes.length === 1 ? "note" : "notes"}</span
        >
      </h2>
      <button type="button" class="sheet-close" onclick={closeOverlay}>Close</button>
    </header>
    <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
         the document's only <main>; sheets are dialogs, not mains. Full focus
         management (inert background, aria-modal) is deferred to T33. -->
    <div class="sheet-body">
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
                  <button type="submit" class="save" disabled={!canSave}>Save</button>
                  <button type="button" class="cancel" onclick={cancelEdit}>Cancel</button>
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
                <!-- .note-text is a durable e2e locator — the class lives
                     where the TEXT lives. -->
                <span class="note-text">{note.text}</span>
                <span class="row-actions">
                  <button
                    type="button"
                    class="row-action"
                    aria-label="Edit"
                    onclick={() => startEdit(note.id, note.text)}
                    disabled={draggedId !== null}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    class="row-action toss"
                    aria-label="Toss"
                    onclick={() => onToss(note.id)}
                    disabled={tossingId !== null || draggedId !== null}
                  >
                    ×
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
</div>

<style>
  /* The sheet's body centers its contents (the flat rows fill the width;
   * the empty state and the error line center inside it). Padding and the
   * paper background come from the shared layer (web/src/sheets.css). */
  .sheet-body {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* -- The flat ledger of rows (§5.3: deliberately plain — top of stack
   * first, no grouping, no boxes around rows; rows separate on a hairline
   * and the paper tone shifts on hover instead of drawing a border). ---- */
  .rows {
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    min-height: 3.25rem;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-lg);
    background: transparent;
    transition: background-color 120ms var(--ease-lift);
  }

  /* Hairline between rows; the last row has no bottom border. */
  .row + .row {
    border-top: 1px solid var(--paper-edge);
  }

  /* The row lifts in place on hover/focus — the sheet's warm tone, no
     border, no shadow, no layout shift. */
  .row:hover,
  .row:focus-within {
    background: var(--paper-warm);
  }

  /* The dragged row (T32 delivered): it does NOT follow the pointer (see
     the script head — hit-testing reads the live row rects, so a
     translated row would corrupt its own drop geometry). It lifts in its
     slot instead: the warm tone plus the shallowest buried-note shadow
     (a raised paper card) and a soft warm edge. */
  .row.dragging {
    background: var(--paper-warm);
    box-shadow: var(--shadow-note-edge-near);
    outline: 1px solid var(--outline-soft);
  }

  /* The current drop target (pure-geometry hit-test): a quiet accent tint
     and a 2px accent inset rail on the left — reads as "this slot", never
     as a layout change. */
  .row.drop-target {
    background: color-mix(in srgb, var(--accent-soft) 18%, var(--paper));
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .handle {
    /* `touch-action: none`: a touch drag is a drag, not a scroll (T28). */
    touch-action: none;
    cursor: grab;
    flex: none;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    background: none;
    border: none;
    border-radius: var(--radius-note);
    color: var(--ink-quiet);
    padding: 0;
    transition: color 120ms var(--ease-lift);
  }

  /* Hover/focus-within darkens the quiet ink (row hover AND handle hover). */
  .row:hover .handle,
  .row:focus-within .handle,
  .handle:hover {
    color: var(--ink-body);
  }

  .note-text {
    /* DESIGN.md §2/§5.3: list rows keep the handwritten voice — Caveat,
       slightly smaller than the desk's top note (§5.3 rows are ledger
       lines, not the pile's centerpiece). */
    font-family: var(--font-hand);
    font-size: 1.35rem;
    line-height: 1.3;
    font-weight: 600;
    color: var(--ink);
    flex: 1;
    min-width: 0;
    /* T28 worst-case guard (§9; shared/src/validation.ts
       NOTE_TEXT_MAX_LENGTH): a 280-char unbroken token must wrap, not
       open a horizontal scrollbar in the sheet at 390px. `anywhere`
       (not break-word) also shrinks the token's min-content size, which
       is what lets the flex item above actually shrink below it. */
    overflow-wrap: anywhere;
  }

  /* -- Row actions: quiet ghost icon buttons (T32), revealed on row
     hover/focus-within via opacity (never display:none — the buttons stay
     in the tab order; §5.3 "small quiet row actions on hover/focus"). -- */
  .row-actions {
    flex: none;
    display: flex;
    gap: var(--space-xs);
    opacity: 0;
    transition: opacity 120ms var(--ease-lift);
  }

  .row:hover .row-actions,
  .row:focus-within .row-actions {
    opacity: 1;
  }

  .row-action {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    background: none;
    border: none;
    border-radius: var(--radius-note);
    color: var(--ink-muted);
    cursor: pointer;
    padding: 0;
    font-size: 1rem;
    line-height: 1;
  }

  .row-action:hover {
    background: var(--paper-shade);
    color: var(--ink-body);
  }

  /* Toss leans accent on hover — the quiet vermilion cue of "this removes
     the note" (the app's one loud color doing quiet work). */
  .row-action.toss:hover {
    color: var(--accent);
  }

  .row-action:disabled {
    cursor: default;
    color: var(--ink-quiet);
    background: none;
  }

  /* -- Inline edit: the shared paper slip input (sheets.css) plus the
     paper-shade Save chip (accent ink) and a quiet ghost Cancel. The row's
     min-height keeps the edit form from changing the row's height. ----- */
  .edit {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  /* The row's inline edit input takes the space beside Save/Cancel
     (T28 §9): flex:1 + min-width:0 so a 280-char draft can never stretch
     the row past the sheet. */
  .edit input {
    flex: 1;
    min-width: 0;
  }

  .edit .save {
    flex: none;
    background: var(--paper-shade);
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-note);
    color: var(--accent);
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--text-label-md);
    white-space: nowrap;
    cursor: pointer;
  }

  .edit .save:disabled {
    color: var(--ink-quiet);
    cursor: default;
  }

  .edit .cancel {
    flex: none;
    background: none;
    border: none;
    border-radius: var(--radius-note);
    color: var(--ink-muted);
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--text-label-md);
    cursor: pointer;
  }

  .edit .cancel:hover {
    background: var(--paper-shade);
    color: var(--ink-body);
  }

  .empty {
    margin: 0;
    width: 100%;
    text-align: center;
    /* Generous vertical air — the empty sheet is a resting surface. */
    padding: var(--space-xl) 0;
    /* var(--ink-muted), not a lighter gray: real copy's quiet-ink floor
       (StackView precedent — the old #999 placeholder was ~2.85:1 on white,
       below WCAG AA; the token is darker than the old #555, so the floor
       holds a fortiori). */
    color: var(--ink-muted);
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
    /* var(--ink-muted): the only failure feedback in the sheet keeps the
       quiet-ink floor ≥ WCAG AA (token darker than the old #555). */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  /* -- Mobile / non-hover (≤640px; the breakpoint literal's documentation
       home is tokens.css): the row actions STOP hiding (a touch row has no
       hover to reveal them) and every small control gets its OWN ≥44px hit
       floor (2.75rem box) — T28's walkthrough guarantee, delivered with
       T32's treatments. The handle's `touch-action: none` (base rule) is
       what keeps a touch drag a drag. */
  @media (max-width: 640px), (hover: none) {
    .row-actions {
      opacity: 1;
    }

    .row {
      padding-inline: var(--space-md);
    }

    .handle,
    .row-action {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
