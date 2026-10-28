<script lang="ts">
  /**
   * StacksDrawer mechanics (T20; sources: TASKS.md T20, DESIGN.md §5.4,
   * DECISIONS.md §4/§6) — the sheet over the desk: every stack (server truth
   * = position order) as a clickable row that switches the active stack,
   * a per-row kebab (Rename, Delete), a confirm modal over the sheet for
   * Delete, and the "+ New stack" footer create form. No drag-reorder UI
   * here — PATCH /position stays a server-only API for v1.
   *
   * Mutations go through the store helpers (T15), each resolving
   * `{ok:true} | {ok:false; error}` — never rejecting. On success the
   * fresher server snapshot is applied before the promise resolves, so
   * there is deliberately NO manual row/list update code: the snapshot
   * drives the UI (the active marker moves, deleted rows vanish, a newly
   * created stack appears — active — at the drawer end). The drawer stays
   * open after a switch; Close/Esc is the explicit exit.
   *
   * -- Kebab menus ---------------------------------------------------------
   * One openMenuId at a time (opening one closes another); the kebab's own
   * click stops propagation and a <svelte:window> click handler closes any
   * open menu on an outside click. Menu-item clicks bubbling to that
   * handler closing the menu is the desired behavior (the item handler has
   * already acted).
   *
   * -- Esc layering (innermost first) --------------------------------------
   * The rename input consumes its own Esc on the INPUT itself (target phase
   * — ListView precedent; focus is in the input when it matters, and Esc
   * with focus elsewhere during a rename falls through to sheet-close, the
   * same accepted ListView behavior). The confirm modal and the open kebab
   * menu are covered by a WINDOW-CAPTURE keydown listener, attached only
   * while either is open: window-capture fires before App.svelte's
   * window-level (bubble) Esc handler, so a keypress consumed there
   * (stopPropagation at the top of the path) never closes the sheet behind
   * an open modal/menu — wherever focus is. Wherever matters because
   * opening a menu item unmounts the focused button and focus resets to
   * <body>, so a bubble-phase section handler would never even fire (see
   * the "Esc layering" block near the effects). With no modal/menu open
   * nothing is consumed and App.svelte's window Esc closes the sheet
   * normally. One accepted order consequence: with a modal or kebab menu
   * open, the capture listener consumes Esc for that topmost surface even
   * when focus sits in the rename input (topmost first: modal > menu >
   * input; no data loss — a second Esc resolves the next surface out, and
   * T33's focus-management pass revisits this order).
   *
   * -- Errors --------------------------------------------------------------
   * ONE shared actionError line for create / switch / rename failures
   * (cleared at each action start, most recent wins — ListView's
   * convention); the delete failure line lives INSIDE the confirm modal so
   * the modal stays open for a retry. Quiet register (§6): no exclamations.
   *
   * Deliberately omitted (note, not bug): the §5.4 pictogram glyph,
   * folded-corner active marker visual, hover-reveal, and animations —
   * T32/T33 own them. This is mechanics with durable text ("— active") and
   * minimal CSS; Phase 3 restyles.
   */
  import { STACK_NAME_MAX_LENGTH } from "@task-stack/shared";
  import { snapshot, createStack, updateStack, deleteStack, setActiveStack } from "../lib/store";
  import { closeOverlay } from "../lib/view";

  const stacks = $derived($snapshot?.stacks ?? []);
  const activeStackId = $derived($snapshot?.activeStackId ?? null);
  const pendingCount = (stackId: string): number =>
    $snapshot?.notes.filter((note) => note.stackId === stackId).length ?? 0;

  // -- Errors ---------------------------------------------------------------
  // One shared line for create / switch / rename; cleared at each action
  // start so the line always shows the most recent failure, never a stale
  // one masking a newer one. Delete has its own line inside the modal.
  let actionError = $state<string | null>(null);

  // -- Switch active (per-row guard: one click = one switch) -----------------
  let switchingId = $state<string | null>(null);

  async function onSwitch(stackId: string): Promise<void> {
    if (switchingId !== null) return;
    if (stackId === activeStackId) return; // already active → no identity PUT
    switchingId = stackId;
    actionError = null;
    const result = await setActiveStack(stackId);
    if (!result.ok) actionError = result.error;
    switchingId = null; // the marker moves via the snapshot
  }

  // -- Kebab menu (one open at a time) ---------------------------------------
  let openMenuId = $state<string | null>(null);

  function toggleMenu(event: MouseEvent, stackId: string): void {
    openMenuId = openMenuId === stackId ? null : stackId;
    // Opening/closing a menu must NOT reach the window click handler as an
    // "outside click" for a different target.
    event.stopPropagation();
  }

  function onWindowClick(): void {
    if (openMenuId !== null) openMenuId = null;
  }

  // -- Rename (ListView's inline edit, one editingId) ------------------------
  let editingId = $state<string | null>(null);
  let editDraft = $state("");
  let saving = $state(false);
  const editTrimmed = $derived(editDraft.trim());
  const canSave = $derived(editTrimmed.length > 0 && !saving);

  function startRename(stackId: string, name: string): void {
    if (editingId !== null) return;
    openMenuId = null;
    editingId = stackId;
    editDraft = name;
    actionError = null;
  }

  function cancelRename(): void {
    editingId = null;
    editDraft = "";
    saving = false;
  }

  async function onRenameSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (editingId === null || !canSave) return;
    saving = true;
    actionError = null;
    const sent = editTrimmed;
    const result = await updateStack(editingId, { name: sent });
    if (result.ok) {
      // Close only if the draft still matches what was saved — typing ahead
      // keeps the form open with the typed-ahead draft (ListView precedent).
      if (editDraft.trim() === sent) cancelRename();
      else saving = false;
    } else {
      // Keep the draft for the retry.
      actionError = result.error;
      saving = false;
    }
  }

  function onRenameKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    cancelRename();
    // Fully consumed: App.svelte's window Esc (sheet close) must not also
    // fire for the same keypress — the sheet stays open.
    event.stopPropagation();
  }

  /** Focuses the node when it mounts — the input appears when rename opens.
   *  Deliberately NO select(): with no undo (DECISIONS.md §4), select-all
   *  plus one stray keystroke would wipe the name. */
  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  // -- Create (footer form; a new stack becomes ACTIVE via server truth) -----
  let createDraft = $state("");
  let creating = $state(false);
  const createTrimmed = $derived(createDraft.trim());
  const canCreate = $derived(createTrimmed.length > 0 && !creating);

  async function onCreateSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canCreate) return;
    creating = true;
    actionError = null;
    const sent = createTrimmed;
    const result = await createStack(sent);
    if (result.ok) {
      // Clear the draft only if nothing was typed during the flight —
      // typing ahead keeps the text (StackView / FirstRun precedent). The
      // drawer stays open; the row appears at the end with the active
      // marker via the snapshot.
      if (createDraft.trim() === sent) createDraft = "";
      creating = false;
    } else {
      // `createDraft` is untouched — the user keeps what they typed.
      actionError = result.error;
      creating = false;
    }
  }

  // -- Delete (confirm modal over the sheet, one in flight at a time) --------
  // confirmDeleteId is the stack awaiting confirmation; deletingId the one
  // in flight. Modal content derives REACTIVELY from the live snapshot so a
  // remote push updates the count in place.
  let confirmDeleteId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  const pendingDelete = $derived(
    confirmDeleteId === null
      ? null
      : ($snapshot?.stacks.find((stack) => stack.id === confirmDeleteId) ?? null),
  );
  const pendingDeleteCount = $derived(
    pendingDelete === null
      ? 0
      : ($snapshot?.notes.filter((note) => note.stackId === pendingDelete.id).length ?? 0),
  );
  // §5.4's copy, verbatim; the N=0 variant for an empty stack.
  const deleteCopy = $derived(
    pendingDelete === null
      ? ""
      : pendingDeleteCount > 0
        ? `Delete '${pendingDelete.name}'? Its ${pendingDeleteCount} notes go with it. Completed notes stay in the Archive.`
        : `Delete '${pendingDelete.name}'? It has no notes. Completed notes stay in the Archive.`,
  );

  function startDelete(stackId: string): void {
    if (deletingId !== null) return;
    openMenuId = null;
    confirmDeleteId = stackId;
    deleteError = null;
  }

  function cancelDeleteConfirm(): void {
    confirmDeleteId = null;
    deleteError = null;
  }

  async function onDeleteConfirm(): Promise<void> {
    if (confirmDeleteId === null || deletingId !== null) return;
    deletingId = confirmDeleteId;
    deleteError = null;
    const result = await deleteStack(confirmDeleteId);
    if (result.ok) {
      // The modal closes; the row vanishes via the snapshot. If the deleted
      // stack was active, the marker moves to the drawer-front survivor
      // (server truth); if it was the last stack, the view machine flips to
      // firstRun and this sheet unmounts — no special code for either.
      cancelDeleteConfirm();
    } else {
      // The modal stays open with its error line for a retry.
      deleteError = result.error;
    }
    deletingId = null;
  }

  // Remote-mutation auto-cancel ($effect): when the stack under rename / an
  // open menu / the confirm modal vanishes from the snapshot (a remote WS
  // delete), close the surface. Same vanishing-conflict stance as
  // ListView's edit auto-cancel (DECISIONS.md §4/§5).
  $effect(() => {
    if (editingId !== null && !stacks.some((stack) => stack.id === editingId)) cancelRename();
    if (openMenuId !== null && !stacks.some((stack) => stack.id === openMenuId)) openMenuId = null;
    if (confirmDeleteId !== null && pendingDelete === null) cancelDeleteConfirm();
  });

  // -- Esc layering (modal / menu) ------------------------------------------
  // A keydown only ever fired the OLD section-level handler when its TARGET
  // was inside the section — but opening the modal the normal way (kebab →
  // menu's Delete click) unmounts the focused menu-item button and focus
  // resets to <body>; a following Esc bubbles body → html → window without
  // ever passing through the section, and App.svelte's window-level Esc
  // (bubble phase, web/src/App.svelte) would close the WHOLE SHEET behind
  // the open modal. The kebab menu has the same hole (focus on body with
  // the menu open).
  //
  // So this component listens at the WINDOW in the CAPTURE phase, attached
  // only while the confirm modal or a kebab menu is open. Capture fires
  // BEFORE any target/bubble listener — including App.svelte's window
  // handler — so stopPropagation here prevents the keypress from ever
  // reaching it, wherever focus is (body included). The handler is total:
  // the modal first (Esc mirrors the Cancel button, which is `disabled`
  // during a delete flight, so a mid-flight Esc consumes without
  // cancelling — it can neither cancel nor fall through to sheet-close),
  // then the open menu, else a no-op (the listener isn't even attached in
  // that state). The effect re-runs when either id changes (never a stale
  // closure) and Svelte tears the listener down exactly when neither
  // surface is open (component unmount included).
  $effect(() => {
    if (confirmDeleteId === null && openMenuId === null) return;
    const onKeydownCapture = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (confirmDeleteId !== null) {
        if (deletingId === null) cancelDeleteConfirm();
      } else {
        openMenuId = null;
      }
      // Consumed at window-capture: App.svelte's bubble-phase window handler
      // never sees this keypress — the sheet stays open.
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeydownCapture, { capture: true });
    return () => window.removeEventListener("keydown", onKeydownCapture, { capture: true });
  });
</script>

<svelte:window onclick={onWindowClick} />

<section class="overlay">
  <header>
    <h2>Stacks</h2>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
    <ul class="rows">
      {#each stacks as stack (stack.id)}
        {@const count = pendingCount(stack.id)}
        {@const isActive = stack.id === activeStackId}
        <li class="row">
          {#if editingId === stack.id}
            <form class="edit" onsubmit={onRenameSubmit}>
              <label class="visually-hidden" for="rename-stack-name">Rename stack</label>
              <input
                id="rename-stack-name"
                type="text"
                bind:value={editDraft}
                maxlength={STACK_NAME_MAX_LENGTH}
                autocomplete="off"
                onkeydown={onRenameKeydown}
                use:focusOnMount
              />
              <button type="submit" disabled={!canSave}>Save</button>
              <button type="button" onclick={cancelRename}>Cancel</button>
            </form>
          {:else}
            <button
              type="button"
              class="stack-button"
              onclick={() => onSwitch(stack.id)}
              disabled={switchingId !== null}
            >
              <span class="name">{stack.name}</span> ({count})
              {#if isActive}<span class="active">— active</span>{/if}
            </button>
            <button
              type="button"
              class="kebab"
              aria-label="Actions for {stack.name}"
              onclick={(event) => toggleMenu(event, stack.id)}
            >
              ⋮
            </button>
            {#if openMenuId === stack.id}
              <div class="menu">
                <button type="button" onclick={() => startRename(stack.id, stack.name)}>
                  Rename
                </button>
                <button type="button" onclick={() => startDelete(stack.id)}>Delete</button>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    {#if actionError !== null}
      <p class="error" role="alert">{actionError}</p>
    {/if}

    <!-- Footer create form (§5.4). Same trim the server applies — the
         enabled state mirrors the server's min-1 rule, so a broken submit
         can only come from a length/type violation, never whitespace. -->
    <form class="create" onsubmit={onCreateSubmit}>
      <label class="visually-hidden" for="drawer-stack-name">Stack name</label>
      <input
        id="drawer-stack-name"
        type="text"
        bind:value={createDraft}
        maxlength={STACK_NAME_MAX_LENGTH}
        placeholder="Name this stack"
        autocomplete="off"
      />
      <button type="submit" disabled={!canCreate}>+ New stack</button>
    </form>
  </div>

  <!-- Confirm modal OVER the sheet: fixed backdrop above the overlay's
       z-index 10 and below App.svelte's connection strip's 20. Its
       markup-wise placement INSIDE the <section> no longer carries any
       behavior: while a menu item is being clicked its focused button
       unmounts and focus resets to <body>, so a later Esc targets body and
       never passes through the section at all — the WINDOW-CAPTURE keydown
       listener ("Esc layering", in the script) consumes it regardless of
       target. Minimal semantics — role="dialog" is enough; the focus trap
       is T33's. -->
  {#if pendingDelete !== null}
    <div class="backdrop">
      <div class="modal" role="dialog">
        <p class="modal-copy">{deleteCopy}</p>
        <div class="modal-actions">
          <button type="button" onclick={cancelDeleteConfirm} disabled={deletingId !== null}>
            Cancel
          </button>
          <button type="button" onclick={onDeleteConfirm} disabled={deletingId !== null}>
            Delete
          </button>
        </div>
        {#if deleteError !== null}
          <p class="error" role="alert">{deleteError}</p>
        {/if}
      </div>
    </div>
  {/if}
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
    gap: 1rem;
  }

  /* Minimal readable rows — the paper look and the pictogram glyph are T32. */
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

  /* position: relative anchors each row's absolutely-positioned menu. */
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--paper-edge);
  }

  /* The row's ONE main button: switch + identity (name, count, marker). */
  .stack-button {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    text-align: left;
    cursor: pointer;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active {
    color: var(--ink-muted);
    font-size: 0.9rem;
    /* The folded-corner visual is T32's; this span never shrinks away. */
    white-space: nowrap;
  }

  .kebab {
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    padding: 0 0.25rem;
  }

  /* Small block within the row (anchored to it), above the row contents. */
  .menu {
    position: absolute;
    right: 0.25rem;
    top: 100%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--paper-edge);
    min-width: 6rem;
  }

  .menu button {
    background: none;
    border: none;
    text-align: left;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .edit {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 0.5rem;
  }

  /* The rename input takes the space beside Save/Cancel (T28 §9):
     flex:1 + min-width:0 so an 80-char unbroken name (STACK_NAME_MAX_
     LENGTH) can never stretch the row past the sheet. */
  .edit input {
    flex: 1;
    min-width: 0;
  }

  /* The footer create form fills the sheet's gutters and caps where the
     rows cap (28rem — same measure as .rows); its input shrinks beside
     the button instead of stretching the row (T28 §9). */
  .create {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    max-width: 28rem;
  }

  .create input {
    flex: 1;
    min-width: 0;
  }

  .error {
    margin: 0;
    text-align: center;
    /* var(--ink-muted): the quiet-ink failure line stays ≥ WCAG AA — the
       token is darker than the old #555, so the floor holds a fortiori
       (ListView precedent). */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  /* Confirm modal backdrop over the sheet: the paper surface at 90% via
     color-mix (evergreen-browsers only, DECISIONS.md §11) — same hazy-veil
     look as the old rgba literal, sourced from tokens.css. The backdrop is
     position:fixed, so it does NOT inherit the .overlay's T28 padding —
     it carries the same gutter itself, which is what `min(24rem, 100%)`
     on .modal below resolves against (T28 §9: the modal must fit at
     390px, long stack names included). */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 15; /* overlay sheets are 10; App's connection strip is 20 */
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--paper) 90%, transparent);
    padding-inline: var(--gutter);
  }

  .modal {
    background: var(--paper);
    border: 1px solid var(--paper-edge);
    padding: 1rem;
    /* Fits at 390px: min() caps at the desktop 24rem and falls back to
       the padded backdrop's width on narrow viewports (T28 §9 — the
       confirm copy names the stack, so the box must never overflow). */
    width: min(24rem, 100%);
    max-width: 24rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-copy {
    margin: 0;
    /* T28 §9: an 80-char stack name inside the confirm sentence must wrap
       (overflow-wrap: anywhere), not push the modal wide enough to
       overflow a 390px viewport. */
    overflow-wrap: anywhere;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
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

  /* -- Mobile (≤640px; TASKS.md T28 §9): thumb-sized kebab and menu
     controls. The breakpoint literal is documented once in tokens.css;
     every repetition cites it. Visually quiet: the ghost looks stay (the
     row's own border box and the menu's paper surface are the existing
     styles; hover fills are T32's polish). */
  @media (max-width: 640px) {
    /* The confirm modal's backdrop is position:fixed, so it does NOT
       inherit the sheet's responsive padding — carry the mobile gutter
       pair here too, or the modal would sit 24px inset while the sheet
       sits 12px (the same consistency the base rule documents). */
    .backdrop {
      padding-inline: var(--gutter-mobile);
    }

    /* Kebab + menu items: each control's OWN ≥44px hit floor (min-height)
       plus comfortable padding. Deliberate boundary, same as the list
       sheet's: labeled sheet buttons (Close/Save/Cancel/+ New stack) keep
       their current comfortable padded sizes — T28's explicit size
       mandate is the thumb-sized Done only (TASKS.md T28); everything
       else must merely be REACHABLE (proven by the walkthrough), and the
       sheets' real button treatment is T32/T33's. */
    .kebab,
    .menu button {
      min-height: 44px;
      padding: var(--space-sm) var(--space-md);
    }
  }
</style>
