<script lang="ts">
  /**
   * StackView mechanics (T18) + T26 stack rendering (sources: TASKS.md
   * T18/T26, DESIGN.md §3/§5.1/§6) — the desk: the growing pile (the T25
   * top note card + T26's buried peeking edges + "+N more" scrap), Done /
   * Edit / Toss action row, "See all N" footer, quick-add form,
   * empty-stack line. Chrome (T16) and the "See all" wiring stay as
   * built. The push spring HAS landed (T27): the landing rule is "the top
   * id of the active stack was absent one observation ago" (lib/push-land)
   * — a push lands; everything else (reload, reveal, reorder, edit, the
   * duplicate WS rebroadcast) stays still. The ceremony comes with
   * T29/T30, and the ghost-outline empty state's visuals with T31.
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
  import NoteCard from "../components/NoteCard.svelte";
  import PeekingEdges from "../components/PeekingEdges.svelte";
  import { hiddenNoteCount, peekingEdges } from "../lib/edge-style";
  import { PushLandingTracker } from "../lib/push-land";

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

  // -- Push landing (T27) ---------------------------------------------------
  // Not an effect value but a MEMO-FREE instance: component-instance
  // lifetime is exactly right because App.svelte keeps StackView mounted
  // under every overlay (list/drawer/archive), so observations are
  // continuous underneath them — opening and closing a sheet never reads
  // as "a new pile" and never re-lands the top note.
  const landingTracker = new PushLandingTracker();
  // The id currently falling/springing onto the pile, cleared by the
  // card's animationend (and manually in startEdit) so it never lingers:
  // a stale flag would replay the drop on the next keyed remount (Edit →
  // Cancel unmounts/remounts the card). The effect is deliberately PRE, not
  // a plain effect: pre-effects run BEFORE the DOM update that mounts the
  // new card, so the landing class is on the element in its FIRST painted
  // frame; a plain effect would mount the card un-landed for one frame,
  // then snap it mid-air (a visible stutter before the drop). It reads the
  // same deriveds the template renders (activeStackId, stackNotes) so the
  // class and the card can never disagree about which note is landing.
  // First observation after mount/reload and the first observation after a
  // stack switch both come back null — only pushes land (lib/push-land).
  // RULE-OFF (svelte/prefer-writable-derived), covering this declaration
  // AND the $effect.pre below: the rule reads the $state-plus-effect pair
  // as the derivable-from-effect anti-pattern and wants a writable
  // $derived, but a derived is structurally wrong here — it would only
  // evaluate when READ, and the card is exactly what stops rendering
  // (edit form replaces it, empty pile clears the branch), so
  // observations would be SKIPPED while the flag cannot be trusted; the
  // tracker must advance exactly once per snapshot REGARDLESS of what the
  // template renders. That "runs on every snapshot change" property needs
  // an effect; the pre-frame timing is a property of $effect.pre
  // specifically, not the reason a derived fails ('pre' runs before the
  // DOM update, so the landing class is in the card's first painted
  // frame). This is genuinely per-snapshot state.
  /* eslint-disable svelte/prefer-writable-derived */
  let landingId = $state<string | null>(null);

  $effect.pre(() => {
    landingId = landingTracker.observe(
      activeStackId ?? "",
      stackNotes.map((note) => note.id),
    );
  });
  /* eslint-enable svelte/prefer-writable-derived */

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
    // Clear any in-flight landing flag: Edit unmounts the card for the
    // form, and Cancel remounts it keyed — a stale landingId would replay
    // the drop on that remount. Closes the sub-half-second window the
    // animationend clear cannot cover (T27; the edit form itself never
    // animates).
    landingId = null;
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
    <!-- The T26 pile: the deck is position:relative and holds BOTH layers —
         the deepest-first peeking edges render FIRST (so shallower edges
         and the top card paint over them), then the existing card /
         edit-form / empty branch. No z-index needed: the T25 .card is
         position:relative, so DOM order paints it above the positioned
         edges (both are in the same stacking context and positioned
         elements paint in DOM order).
         class:pile (topNote !== null): the pile keeps its 320px footprint
         through edit mode too — read the .deck/.pile CSS, the deck must
         not collapse when the short edit form replaces the tall card, or
         the edges re-anchor around the shrunk box and the whole pile
         jumps mid-edit. The EMPTY state deliberately gets no footprint:
         its quiet centered line is the pre-pile look (T31 owns its ghost
         visual). -->
    <div class="deck" class:pile={topNote !== null}>
      <PeekingEdges notes={peekingEdges(stackNotes)} hidden={hiddenNoteCount(noteCount)} />
      {#if topNote !== null}
        {#if editingId === topNote.id}
          <!-- The inline edit form MUST be position:relative: non-positioned
               in-flow content paints BELOW positioned siblings — our edges
               are positioned and would cover the form (classic stacking
               bug). This restores DOM-order painting for it. -->
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
          <!-- The T25 paper card: material (grain/glue/edge/shadow) plus the
               deterministic tilt and palette color, text in Caveat.
               .note-text (the e2e locator) lives inside the card. While
               editing, the card is replaced by the edit form — same swap
               the placeholder made.
               {#key topNote.id} (T27): every push produces a FRESH card
               element, so (a) a second push during a still-running
               animation restarts cleanly on the new card, and (b) the
               duplicate WS rebroadcast of the same snapshot (same top id)
               remounts nothing and cannot re-trigger anything. Reveal
               after done/toss and reorder land here too — a fresh card
               WITHOUT the landing class (the reveal ceremony is T29's) —
               and edit changes nothing at all, so no remount, no motion. -->
          {#key topNote.id}
            <NoteCard
              note={topNote}
              landing={landingId === topNote.id}
              onLanded={() => (landingId = null)}
            />
          {/key}
        {/if}
      {:else}
        <!-- Quiet empty state (§5.1); the ghost-outline visual is T31.
             noteCount 0 → peekingEdges([]) is [] and hiddenNoteCount is 0,
             so the deck renders empty — fine until T31's ghost. -->
        <p class="empty">The stack is empty.</p>
      {/if}
    </div>
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
    color: var(--ink-quiet);
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

  /* The pile's positioning context (T26): relative so the absolute buried
     edges (PeekingEdges) and the scrap anchor to it, not the page. The
     pile vars are defined on the BASE class (not .pile) so they inherit
     into the edges in every state; .pile (below) spends them on size.
     NOTE the footprint stays honest per axis only: the horizontal
     offsets (±10px) have centered slack at every viewport we run at, but
     this rule makes no absolute guarantee about any overflow — it merely
     keeps the deck from ADDING scrollable overflow through its own size. */
  .deck {
    position: relative;
    /* The pile silhouette, defined ONCE here: the card, the edges, and
       .pile's box all read these two vars — so edit mode, view mode, and
       the buried layers can never disagree about how big the pile is.
       T28's responsive pass will tokenize this (with NoteCard's identical
       literal today). */
    --pile-w: min(320px, 90vw);
    --pile-h: 320px;
  }

  /* Pile present (a top note exists — card OR edit form): give the
     deck the pile's full footprint even while the SHORT inline edit form
     is the only in-flow child. Why: without it, the deck collapses to the
     form's ~25px height, .stage's align-items:center re-centers the
     shrunk box (~150px jump), the absolutely-positioned 320px edges
     re-anchor around the shrunken deck, and they then paint OVER the
     .actions row (positioned elements paint above non-positioned
     siblings; pointer-events:none makes it click-through, so it silently
     covers Done/Edit/Toss without blocking their clicks — invisible
     paper over the desk's controls). Flex centering keeps the edit form
     at the pile's visual center (the card's resting spot), so entering
     edit mode no longer moves anything.
     Flex-item geometry: the card carries the same literal
     min(320px, 90vw)/320px silhouette, so view mode's box is identical —
     and min-height (not height) keeps a long note growing the pile.
     flex-direction: COLUMN puts the edit form and its error line back
     into the vertical stack they had pre-T26 (default-direction row
     would squeeze error beside the 320px-wide form); the card is a
     single item and still centers on both axes.
     Accepted residual (T26): a top note TALLER than 320px — a long
     note — still settles the deck to the 320px floor when the card
     unmounts for the edit form, so entering edit shifts the pile by
     roughly (cardHeight − 320)/2. Left un-diagnosed is no overlap either
     way; the full fix — keeping the card box in flow beneath the
     overlaying form — is T28's layout pass. */
  .deck.pile {
    width: var(--pile-w);
    min-height: var(--pile-h);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }

  /* The top note's paper card lives in components/NoteCard.svelte (T25);
     only the inline edit form keeps a local rule here, so entering/leaving
     edit mode doesn't visually jump families — same Caveat as the card text. */

  /* The inline edit form must be POSITIONED: non-positioned in-flow content
     paints below positioned siblings, and the buried edges (T26
     PeekingEdges) are positioned — the form would render beneath the paper
     edges it sits on. position:relative restores DOM-order painting. */
  .edit {
    position: relative;
  }

  .empty {
    /* var(--ink-muted), not a lighter gray: real copy's quiet-ink floor
       (FirstRunView precedent — the old #999 placeholder was ~2.85:1 on
       white, below WCAG AA; the token is darker than the old #555, so ≥
       WCAG AA holds a fortiori). */
    color: var(--ink-muted);
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
    /* The single loud primary (DESIGN.md §2/§5.1): vermilion accent, white
       on it — the mockup's Done replaces the old gray placeholder. */
    background: var(--accent);
    color: var(--on-accent);
    border: none;
  }

  .edit {
    background: none;
    border: none;
  }

  .toss {
    background: none;
    border: none;
    color: var(--ink-quiet);
  }

  .below {
    display: flex;
    justify-content: center;
  }

  .link {
    border: none;
    background: none;
    text-decoration: underline;
    color: var(--ink-muted);
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
    /* position:relative — the ONLY failure feedback must never paint
       beneath positioned siblings: the edit flow's error lives inside
       .deck, positioned .edge peers would cover non-positioned content
       (the same stacking hazard the edit form's relative guards against).
       Harmless for the two error sites outside the deck (actions row,
       quick-add). */
    position: relative;
    /* var(--ink-muted) (not a lighter gray): this is the ONLY failure
       feedback, and it keeps the ≥ WCAG AA quiet-ink floor — the token is
       darker than the old #555, so the rationale holds a fortiori. */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  /* Inline edit input: same handwritten family as .note-text (above) so the
     transition between reading and editing doesn't visually jump (T24's
     semantic font boundary; sizes/weights stay Phase 3's business). */
  .edit input {
    font-family: var(--font-hand);
  }
</style>
