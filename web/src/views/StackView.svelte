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
    // Clear any in-flight landing flag: the landing class is bound to this
    // flag, so while it lingers the class stays on the card through the
    // whole edit (the form overlays a concealed card since T28 — see the
    // deck markup) and a push-during-edit would hand it to the next keyed
    // remount. Cancel remounts nothing anymore (the card stays in flow,
    // merely concealed), but the flag MUST still be cleared the moment the
    // user enters edit: push-motion's Phase 4b pins exactly this clear as
    // the guard that removes the class mid-flight (T27; the edit form
    // itself never animates).
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
         and the top card paint over them), then the card / edit-form /
         empty branch. No z-index needed: the T25 .card is
         position:relative, so DOM order paints it above the positioned
         edges (both are in the same stacking context and positioned
         elements paint in DOM order).
         class:pile (topNote !== null): the pile keeps its footprint
         through edit mode too — read the .deck/.pile CSS and the T28 note
         below: the card never leaves the flow anymore, so the deck's box
         is the pile's box in EVERY state and nothing can jump. The EMPTY
         state deliberately gets no footprint: its quiet centered line is
         the pre-pile look (T31 owns its ghost visual). -->
    <div class="deck" class:pile={topNote !== null}>
      <PeekingEdges notes={peekingEdges(stackNotes)} hidden={hiddenNoteCount(noteCount)} />
      {#if topNote !== null}
        <!-- The T25 paper card renders ALWAYS while a top note exists —
             T28's edit-shift fix (the old .deck.pile "accepted residual"):
             before, edit mode REPLACED the card with the form, the deck
             collapsed toward its 320px floor for a tall note, the whole
             pile jumped, and the re-anchored edges could paint over the
             action row. Now the card merely goes `concealed` (visibility:
             hidden — keeps its box in flow; see NoteCard) while the edit
             form overlays it, so the deck's height is max(card, floor) at
             all times and NOTHING shifts when edit opens or closes. All
             other card behavior is untouched: {#key topNote.id} still
             remounts per top id (T27's fresh-element rule — a second push
             during a running animation restarts cleanly; the duplicate WS
             rebroadcast of the same top id remounts nothing; reveal after
             done/toss lands here too, without the landing class — the
             reveal ceremony is T29's), and `landing` still flows from the
             tracker. While editing, `concealed` is what hides the card —
             NOT an unmount — so the landing/keyed-remount path above is
             the only remount path left. -->
        {#key topNote.id}
          <NoteCard
            note={topNote}
            concealed={editingId === topNote.id}
            landing={landingId === topNote.id}
            onLanded={() => (landingId = null)}
          />
        {/key}
        {#if editingId === topNote.id}
          <!-- The inline edit form: an absolutely-positioned SIBLING over
               the concealed card (T28), not a replacement of it. The form
               MUST still be positioned — the buried edges are positioned
               and non-positioned in-flow content would paint BELOW them —
               and position:absolute over the pile's box puts the form's
               contents exactly where the card's center is (see the .edit
               rule). The editError line lives INSIDE this form container,
               deliberately: as a flow sibling it would be laid out beside
               the concealed card's full-height box (flex column) and grow
               the pile mid-edit — the very jump this restructure kills —
               while inside the inset:0 overlay it stays centered within
               the deck's box, below the form controls, and away from the
               action row (server error strings are short by construction —
               the store's typed errors — so the centered line never
               approaches the deck's bottom edge). -->
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
            {#if editError !== null}
              <p class="error" role="alert">{editError}</p>
            {/if}
          </form>
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
  /* T28 (DESIGN.md §8, TASKS.md T28): the desk is the responsive shell —
     ambient-centered on desktop (the base styles), the stack filling the
     view on mobile (the media block at the end of this sheet). Gutters and
     rhythm come only from the T24 spacing tokens (tokens.css): the desk's
     inline padding is the desktop gutter, swapped to --gutter-mobile in
     the media block; --space-md leads the column and --space-sm separates
     its children (chrome / stage / actions / below / quick-add). No new
     spacing values anywhere. */
  .desk {
    /* The two-line cascade is the dvh progressive pattern (DECISIONS.md
       §11 evergreen-only): 100vh first for anything older, then 100dvh so
       a mobile URL bar's collapse/expand is honored honestly. */
    min-height: 100vh; /* pre-dvh fallback */
    min-height: 100dvh; /* evergreen dynamic viewport (DECISIONS.md §11) */
    display: flex;
    flex-direction: column;
    padding-inline: var(--gutter);
    padding-block-start: var(--space-md);
    gap: var(--space-sm);
  }

  .chrome {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* The chrome title is a centered COLUMN — stack name over the tiny
     "8 notes" underneath — per DESIGN.md §5.1's parenthetical and BOTH
     mockups (stack_view_home and mobile_stack_view_home both render the
     name above the count). It is a flex column at every width, so the
     desktop and mobile chrome read identically. overflow-wrap: anywhere
     is the 80-char-name guard (shared/src/validation.ts
     STACK_NAME_MAX_LENGTH): a long unbroken name wraps instead of opening
     a horizontal scrollbar. e2e reads .title by text content only, so the
     restructure is assertion-safe. */
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
    text-align: center;
    overflow-wrap: anywhere;
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
     edges (PeekingEdges) and the scrap anchor to it, not the page — and,
     since T28, so the absolute edit form overlays the pile, not the page.
     NOTE the footprint stays honest per axis only: the horizontal
     offsets (±10px) have centered slack at every viewport we run at, but
     this rule makes no absolute guarantee about any overflow — it merely
     keeps the deck from ADDING scrollable overflow through its own size. */
  .deck {
    position: relative;
  }

  /* Pile present (a top note exists — card, concealed or not): give the
     deck the pile's full footprint. T28 update: the card no longer
     unmounts for the edit form (it goes visibility:hidden in flow — see
     the deck markup note), so the deck's height is max(cardHeight, floor)
     in EVERY state and the old edit-shift residual is CLOSED — entering
     or leaving edit moves nothing, for short and tall notes alike.
     The silhouette vars themselves moved to tokens.css (T28): --pile-w
     and --pile-h live on :root now, single source for the deck box, the
     card, and the buried edges (the T25/T26 comment-pair contract across
     the three files points there); this rule just SPENDS them.
     min-height (not height) keeps a long note growing the pile.
     flex-direction: COLUMN centers the (single) card on both axes; the
     edit form is absolutely positioned and out of this flow entirely. */
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

  /* The inline edit form (T28 restructure): an absolutely-positioned
     overlay filling the pile's box — inset:0 of the position:relative
     deck — with its contents centered over the pile, i.e. exactly where
     the concealed card's center is. It MUST be positioned: the buried
     edges (T26 PeekingEdges) are positioned and non-positioned in-flow
     content would paint beneath the paper edges it sits on. Absolute
     (was relative pre-T28) because the card now stays in flow beneath it;
     DOM-order painting is preserved the same way — a positioned element
     later than the edges paints above them, and above the concealed card,
     which is what an overlay form should do.
     Scoped to `.deck .edit` deliberately: the actions row's ghost button
     ALSO carries the class .edit, and pre-T28 the shared bare selector was
     harmless (position:relative on the button, background:none on the
     form — both no-ops). The overlay form made the selector
     layout-critical (an unscoped `position:absolute; inset:0` would
     spread the Edit button across the whole desk), so both rules are now
     pinned to their containers. */
  .deck .edit {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
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

  /* -- Action row buttons (T28; DESIGN.md §2 "quiet and few", §5.1 action
     row; mockups' Done stamp). Sizing/presence folded into the base rules;
     the ≤640px block at the end adds only the thumb-sized floors. NO
     transition/animation properties anywhere here — motion stays owned by
     T27's landed work and T29/T30/T32/T33 — and no hover/active scale
     transforms. */
  .done {
    /* The single loud primary (DESIGN.md §2/§5.1): vermilion accent, white
       on it — the mockup's Done replaces the old gray placeholder. */
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    /* The mockup's Done stamp: pill radius, the accent's warm glow
       (--shadow-btn-accent), and a small uppercase label
       (--text-label-lg + tracking) at BOTH breakpoints — the mobile block
       only adds min-height/min-width thumb floors on top. */
    padding: var(--space-sm) var(--space-xl);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-btn-accent);
    font-size: var(--text-label-lg);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Ghost Edit + quietest-ghost Toss (§2/§5.1): bare ink, comfortable
     padding on the desktop base; the mobile block raises both to
     ≥44px hit targets without changing their quiet looks. A --paper-shade
     hover fill gives the ghosts pointer feedback (no motion). Scoped to
     `.actions` for the same reason the form rule is scoped to `.deck`
     (see above): the class .edit is shared with the overlay form, and an
     unscoped `:hover` fill would tint the whole pile whenever the form is
     hovered. */
  .actions .edit {
    background: none;
    border: none;
    padding: var(--space-xs) var(--space-sm);
  }

  .actions .edit:hover,
  .actions .toss:hover {
    background: var(--paper-shade);
  }

  .actions .toss {
    background: none;
    border: none;
    color: var(--ink-quiet);
    padding: var(--space-xs) var(--space-sm);
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

  /* Quick-add (DESIGN.md §3 "quick-add input — styled like a blank note"):
     the strip centers its slip; the slip itself is the paper affordance at
     BOTH breakpoints (mockup "quick-add paper slip" — reference
     mobile_stack_view_home): paper surface, --paper-edge hairline,
     --radius-note corners, the input-slip shadow, and comfortable slip
     padding. width:100% + max-width spans the mobile gutters while
     capping the desktop slip at 26rem; the input takes the rest
     (flex:1 + min-width:0 — min-width:0 is what lets a flex item shrink
     below its content, so a 280-char paste never stretches the row).
     On mobile the whole strip pins to the bottom (media block below). */
  .quick-add {
    display: flex;
    justify-content: center;
    /* env(safe-area-inset-bottom) is 0 wherever there is no inset (all
       desktops) → max() resolves to the token; on notched phones it
       lifts the slip above the home indicator. max(), not the raw env():
       the token floor keeps the desktop spacing identical. */
    padding-block-end: max(var(--space-md), env(safe-area-inset-bottom));
  }

  .quick-add form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 26rem;
    background: var(--paper);
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-note);
    box-shadow: var(--shadow-input);
    padding: var(--space-sm) var(--space-md);
  }

  .quick-add input {
    flex: 1;
    min-width: 0;
  }

  /* The Push button, quiet per the mobile mockup: a paper-shade chip with
     the accent as INK only (the slip is the affordance, not the button —
     §2 "quiet and few"). radius-note chips it into the slip. The UA focus
     outline is deliberately untouched — T33 owns focus styling. */
  .quick-add button {
    background: var(--paper-shade);
    color: var(--accent);
    border: none;
    border-radius: var(--radius-note);
    padding: var(--space-xs) var(--space-md);
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
       beneath positioned siblings. Since T28 the edit error sits inside
       the absolutely-positioned .edit form (see the deck markup), where
       the relative is redundant but harmless; the two error sites outside
       the deck (actions row, quick-add) still want it. */
    position: relative;
    /* var(--ink-muted) (not a lighter gray): this is the ONLY failure
       feedback, and it keeps the ≥ WCAG AA quiet-ink floor — the token is
       darker than the old #555, so the rationale holds a fortiori. */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  /* Inline edit input: same handwritten family as .note-text (above) so the
     transition between reading and editing doesn't visually jump (T24's
     semantic font boundary; sizes/weights stay Phase 3's business). Scoped
     to `.deck .edit` for the same reason as the form rule above — the
     class .edit is shared with the actions row's ghost button. */
  .deck .edit input {
    font-family: var(--font-hand);
  }

  /* -- Mobile (≤640px; DESIGN.md §8, §5.1 mobile layout; TASKS.md T28) --
     The breakpoint literal is documented once in tokens.css (var() cannot
     appear in @media queries; every repetition cites that comment).
     Desktop-first: everything above is the base; only deltas live here. */
  @media (max-width: 640px) {
    /* The mobile gutter pair (§4 gutters; --gutter-mobile is T24's). */
    .desk {
      padding-inline: var(--gutter-mobile);
    }

    /* §5.1's mobile composition ("the stack fills the middle of the
       screen; Done/Edit/Toss row directly under the note"): the stage
       gives up its desktop `flex: 1` — on desktop the leftover column
       height ambient-centers the pile (the desktop mockup's centered
       stage), but on mobile that same centering lands the action row
       ~170px below a short card. flex:none + the min-height reserve take
       the pile's box PLUS its edge poke, so the row sits DIRECTLY under
       the note (the mobile mockup's min-h-[360px] upper-middle stage —
       ours lands at 380px for the app's 320px pile), then "See all N".
       The leftover space then goes BETWEEN "See all" and the strip:
       margin-top:auto pins the quick-add to the bottom in the no-scroll
       case and resolves to 0 when the column overflows, so it composes
       with the sticky pin below for the tall/scroll case. Desktop is
       deliberately untouched — its `flex: 1` ambient centering matches
       §5.1's desktop layout and the desktop mockup's justify-between
       composition, with the same edge-poke slack coming from the
       leftover column height instead of a reserve.
       The 60px reserve itself: flex:none alone would take exactly the
       DECK's content height, but the deepest buried edge's rotated AABB
       reaches ~30px BELOW the deck box — (160·cos8° + 155·sin8° + 10) −
       160 ≈ 30px at the 390-width silhouette (the half-height sin term
       from the ~310px box width plus the 10px edgeY drop) — poking into
       the action-row band (the T26 Phase-5 invariant class;
       pointer-events:none keeps clicks working, which is exactly why it
       must be guarded geometrically). 60px = 2 × that reach, because the
       stage CENTERS the deck (align/justify center) — the reserve must
       cover the poke on both sides, so the stage holds the pile's box
       AND its edges at mobile. It also gives the empty-state line a real
       centered stage again (T31's ghost renders inside it).
       The strip itself: margin-top:auto (above) plus position:sticky
       bottom:0 — sticky, not fixed, so it stays inside the desk's flow
       (the flex column's last child) and rides up over scrolled content
       only while there is content beneath it; the desk-colored
       background is what makes the pin honest (scrolled content must not
       read through the strip). Desktop keeps the in-column flow (no
       sticky — the breakpoint phase pins `position: static` there). */
    .stage {
      flex: none;
      min-height: calc(var(--pile-h) + 60px);
    }

    .quick-add {
      margin-top: auto;
      position: sticky;
      bottom: 0;
      background: var(--desk); /* scrolled content must not read through */
    }

    /* Thumb-sized Done (the explicit T28 requirement, §5.1 "Big Done
       target"; mockup stamp): 48px tall, 112px wide floors under the
       shared pill/accent/shadow/type rules from the base sheet. */
    .done {
      min-height: 48px;
      min-width: 112px;
    }

    /* Edit/Toss: ≥44px hit targets (pointer-target floor), comfortable
       inline padding, ghost looks unchanged. Same .actions scoping as the
       base rules (the class .edit is shared with the overlay form). */
    .actions .edit,
    .actions .toss {
      min-height: 44px;
      padding-inline: var(--space-md);
    }
  }
</style>
