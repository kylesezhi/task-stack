<script lang="ts">
  /**
   * StacksDrawer (T20 mechanics + T32 sheet polish; sources: TASKS.md
   * T20/T32, DESIGN.md §5.4, DECISIONS.md §4/§6) — the paper sheet sliding
   * in from the LEFT over the desk (lib/sheet-motion's x-axis slide; reduced
   * motion → fade): every stack (server truth = position order) as a
   * clickable paper-slip row that switches the active stack, a per-row kebab
   * (Rename, Delete) over a floating paper-card menu, a confirm modal over
   * the sheet for Delete, and the "+ New stack" footer create form. The
   * T32 layer (web/src/sheets.css) supplies the shared scrim + sheet
   * language; this file adds the drawer's own §5.4 details (the tiny
   * 3-layer sticky-note pictogram, the folded-corner active marker). No
   * drag-reorder UI here — PATCH /position stays a server-only API for v1.
   *
   * Mutations go through the store helpers (T15), each resolving
   * `{ok:true} | {ok:false; error}` — never rejecting. On success the
   * fresher server snapshot is applied before the promise resolves, so
   * there is deliberately NO manual row/list update code: the snapshot
   * drives the UI (the active marker moves, deleted rows vanish, a newly
   * created stack appears — active — at the drawer end). The drawer stays
   * open after a switch; Close/Esc is the explicit exit.
   *
   * -- Kebab menus (T33 slice 2) -------------------------------------------
   * One openMenuId at a time (opening one closes another); the kebab's own
   * click stops propagation and a <svelte:window> click handler closes any
   * open menu on an outside click. Menu-item clicks bubbling to that
   * handler closing the menu is the desired behavior (the item handler has
   * already acted). The kebab is a disclosure control (aria-expanded) and
   * its element is remembered as menuTrigger when it toggles a menu: the
   * menu's first item takes focus on open (use:focusFirst) and Esc-closing
   * the menu puts focus back on the kebab — a menu is dismissal content,
   * not a dialog, so there is no trap and no return-on-destroy.
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
   * normally. The capture handler also owns the T33 slice-2 focus returns:
   * Esc on the modal restores focus to the menuTrigger kebab (the modal's
   * dialogFocus returnFocus), and Esc on the menu focuses the kebab
   * directly. One accepted order consequence: with a modal or kebab menu
   * open, the capture listener consumes Esc for that topmost surface even
   * when focus sits in the rename input (topmost first: modal > menu >
   * input; no data loss — a second Esc resolves the next surface out).
   *
   * -- Errors --------------------------------------------------------------
   * ONE shared actionError line for create / switch / rename failures
   * (cleared at each action start, most recent wins — ListView's
   * convention); the delete failure line lives INSIDE the confirm modal so
   * the modal stays open for a retry. Quiet register (§6): no exclamations.
   */
  import { fade } from "svelte/transition";
  import { tick } from "svelte";
  import { STACK_NAME_MAX_LENGTH } from "@task-stack/shared";
  import { snapshot, createStack, updateStack, deleteStack, setActiveStack } from "../lib/store";
  import { closeOverlay } from "../lib/view";
  import { sheetIn, sheetOut } from "../lib/sheet-motion";
  import { dialogFocus, focusFirst } from "../lib/dialog-focus";
  import Icon from "../components/Icon.svelte";

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
  /** The kebab button that toggled the CURRENT menu — the focus return
   * target when Esc closes the menu, when a rename started from it ends,
   * and (via the modal's dialogFocus) when the delete confirm closes.
   * Only one menu is ever open, so one slot is enough; stale values are
   * harmless because every consumer checks isConnected first. */
  let menuTrigger = $state<HTMLElement | null>(null);

  function toggleMenu(event: MouseEvent, stackId: string): void {
    menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
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
    // Restore focus to the kebab when the rename ended with focus INSIDE the
    // form (Cancel button, save, or the input's Esc): the form is about to
    // unmount and would otherwise drop focus to <body>. A remote
    // auto-cancel (the stack vanished via WS) must never STEAL focus —
    // check where focus actually sits before touching it.
    const active = document.activeElement;
    const focusWasInForm =
      editingId !== null && active instanceof HTMLElement && active.closest(".edit") !== null;
    editingId = null;
    editDraft = "";
    saving = false;
    if (focusWasInForm && menuTrigger !== null && menuTrigger.isConnected) {
      menuTrigger.focus();
    }
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
      await tick();
      // The modal's dialogFocus restored focus to the deleted stack's kebab
      // — which just vanished from the snapshot — so focus fell to <body>.
      // A keyboard user must not be stranded there: prefer the footer
      // create input (the drawer's natural resting control; it is where
      // first-run users land too) and fall back to the sheet's Close button.
      // With the LAST stack deleted the whole drawer unmounts (the view
      // machine flips to firstRun), so both queries find nothing and this
      // no-ops — the First Run screen mounts its own focused input.
      if (document.activeElement === document.body) {
        const firstRunInput = document.querySelector<HTMLElement>("#stack-name");
        (
          firstRunInput ?? document.querySelector<HTMLElement>(".sheet--drawer .sheet-close")
        )?.focus();
      }
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
  // that state). Each close also returns focus (T33 slice 2): the modal's
  // dialogFocus is created with returnFocus: menuTrigger, so cancelling it
  // puts focus back on the kebab by itself; the MENU has no dialog action,
  // so Esc-closing it focuses the kebab here. The effect re-runs when
  // either id changes (never a stale closure) and Svelte tears the
  // listener down exactly when neither surface is open (component unmount
  // included).
  $effect(() => {
    if (confirmDeleteId === null && openMenuId === null) return;
    const onKeydownCapture = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (confirmDeleteId !== null) {
        if (deletingId === null) cancelDeleteConfirm();
      } else {
        openMenuId = null;
        // Focus is in (or was last in) the menu being unmounted — put it
        // back on the kebab that opened it, if that button still exists.
        if (menuTrigger !== null && menuTrigger.isConnected) menuTrigger.focus();
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

<!-- The scrim fades in only (`in:fade`, a plain 160ms backdrop veil) — an
     intro-only transition's out() is a no-op, so the overlay is never
     marked inert; the still-mounted scrim keeps blocking desk input until
     the sheet's outro finishes and the block is removed, while the sheet
     subtree itself is inert during its slide-out. The SHEET slides in from
     the left (lib/sheet-motion's x-axis; reduced motion → fade). -->
<div class="overlay overlay--drawer" in:fade={{ duration: 160 }}>
  <!-- role="dialog" + aria-modal + use:dialogFocus (T33 slice 2): the drawer
       IS the dialog — focus lands inside on open, Tab is trapped, the
       App-inerted desk stays inert behind it — and it goes inert ITSELF
       while the confirm modal is up, so the modal is the only interactive
       surface. A div, not a <section>: the section element's own
       landmark-ish semantics would clash with (and svelte-check rejects)
       the interactive dialog role — the class carries the sheet's look,
       not the tag. -->
  <div
    class="sheet sheet--drawer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawer-title"
    inert={pendingDelete !== null}
    use:dialogFocus
    in:sheetIn={{ x: -48 }}
    out:sheetOut={{ x: -32 }}
  >
    <header class="sheet-header">
      <div class="sheet-title-block">
        <h2 class="sheet-heading" id="drawer-title">
          Stacks
          <span class="sheet-count" aria-hidden="true"
            >{stacks.length === 1 ? "1 stack" : `${stacks.length} stacks`}</span
          >
        </h2>
      </div>
      <button type="button" class="sheet-close" aria-label="Close" onclick={closeOverlay}>
        <Icon name="close" />
      </button>
    </header>
    <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
         the document's only <main>; sheets are dialogs, not mains. Focus
         management landed with T33 slice 2 (dialogFocus above; the desk is
         inerted by App.svelte while this sheet is open). -->
    <div class="sheet-body">
      <ul class="rows">
        {#each stacks as stack (stack.id)}
          {@const count = pendingCount(stack.id)}
          {@const isActive = stack.id === activeStackId}
          <li class="row" class:active-row={isActive}>
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
                <button type="submit" class="save" disabled={!canSave}>Save</button>
                <button type="button" class="cancel" onclick={cancelRename}>Cancel</button>
              </form>
            {:else}
              <!-- The §5.4 pictogram: a tiny sticky-note stack — three
                   tilted rounded paper layers, pure CSS, tokens only
                   (aria-hidden: decoration, never announced). -->
              <span class="pictogram" aria-hidden="true">
                <span class="layer back"></span>
                <span class="layer mid"></span>
                <span class="layer front"></span>
              </span>
              <!-- The row's ONE main button: switch + identity (name, count,
                   marker). Text format "name (N)" and "— active" is durable —
                   the e2e asserts both: the count and marker live in a quiet
                   subline under the prominent name. -->
              <button
                type="button"
                class="stack-button"
                onclick={() => onSwitch(stack.id)}
                disabled={switchingId !== null}
              >
                <span class="name-row">
                  <span class="name">{stack.name}</span>
                  {#if isActive}<span class="dot" aria-hidden="true"></span>{/if}
                </span>
                <span class="sub"
                  >({count}){#if isActive}<span class="active"> — active</span>{/if}</span
                >
              </button>
              <button
                type="button"
                class="kebab"
                aria-label="Actions for {stack.name}"
                aria-expanded={openMenuId === stack.id}
                onclick={(event) => toggleMenu(event, stack.id)}
              >
                <Icon name="kebab" />
              </button>
              {#if openMenuId === stack.id}
                <!-- Floating paper card, anchored to the row. use:focusFirst
                     (T33 slice 2) puts focus on the first item when the menu
                     opens — the row keeps it (focus-within) and Esc/outside
                     dismissal hands it back to the kebab. -->
                <div class="menu" use:focusFirst>
                  <button
                    type="button"
                    class="menu-item"
                    onclick={() => startRename(stack.id, stack.name)}
                  >
                    <Icon name="edit" size={16} />
                    Rename
                  </button>
                  <div class="menu-divider" aria-hidden="true"></div>
                  <button
                    type="button"
                    class="menu-item delete"
                    onclick={() => startDelete(stack.id)}
                  >
                    <Icon name="delete" size={16} />
                    Delete
                  </button>
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>

      {#if actionError !== null}
        <p class="error" role="alert">{actionError}</p>
      {/if}
    </div>

    <!-- Footer create form (§5.4). Same trim the server applies — the
         enabled state mirrors the server's min-1 rule, so a broken submit
         can only come from a length/type violation, never whitespace.
         A direct child of the sheet, after the flex:1 body: with little
         content it sits at the bottom; with many stacks the body grows and
         the overlay scrolls.
         Esc here is deliberately DIFFERENT from the desk's quick-add: the
         drawer is a MODAL sheet, so Esc closes it via App.svelte's window
         handler — dismissal is the correct dialog behavior — while the desk's
         quick-add is not dismissal content: its input consumes Esc to
         clear its draft instead (StackView's onQuickAddKeydown). -->
    <form class="create" onsubmit={onCreateSubmit}>
      <!-- The label keeps its durable "Stack name" text (e2e's getByLabel);
           it renders as the mockups' visible micro-label over the footer
           input instead of hiding. -->
      <label class="create-label" for="drawer-stack-name">Stack name</label>
      <div class="create-row">
        <input
          id="drawer-stack-name"
          type="text"
          bind:value={createDraft}
          maxlength={STACK_NAME_MAX_LENGTH}
          placeholder="Name this stack"
          autocomplete="off"
        />
        <button type="submit" class="create-button" disabled={!canCreate}>+ New stack</button>
      </div>
    </form>
  </div>

  <!-- Confirm modal OVER the sheet: fixed backdrop (the same warm ink scrim
       the sheets sit on) above the overlay's z-index 10 and below
       App.svelte's connection strip's 20. Its markup-wise placement inside
       the overlay div no longer carries any behavior: while a menu item is
       being clicked its focused button unmounts and focus resets to <body>,
       so a later Esc targets body and never passes through the sheet at all
       — the WINDOW-CAPTURE keydown listener ("Esc layering", in the script)
       consumes it regardless of target. Full dialog semantics (T33 slice
       2): role="dialog" + dialogFocus traps Tab inside, focuses the first
       control (Cancel) on open, and returns focus to the menuTrigger kebab
       on close (the kebab is gone after a successful delete, so the
       destroy falls back to body and onDeleteConfirm re-homes focus on the
       sheet's Close button). The drawer sheet is inert while this is open. -->
  {#if pendingDelete !== null}
    <div class="backdrop">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-copy"
        use:dialogFocus={{ initialFocus: "first", returnFocus: menuTrigger }}
      >
        <!-- The mockups' pinned desk notice (stacks_drawer_delete_confirm's
             "Pinned Desk Notice Card"): vermilion tack + tape sheen over
             the paper card. Purely decorative over the named dialog. -->
        <span class="tack" aria-hidden="true"><span class="tack-pin"></span></span>
        <span class="tape" aria-hidden="true"></span>
        <!-- Visually hidden dialog name — the visible copy below is the
             describedby body, not the name. -->
        <h3 id="delete-title" class="visually-hidden">Delete stack</h3>
        <p id="delete-copy" class="modal-copy">{deleteCopy}</p>
        <div class="modal-actions">
          <button
            type="button"
            class="cancel"
            onclick={cancelDeleteConfirm}
            disabled={deletingId !== null}
          >
            Cancel
          </button>
          <!-- Delete is the accent stamp: the one loud color earns its
               keep here — this button destroys notes. -->
          <button
            type="button"
            class="delete"
            onclick={onDeleteConfirm}
            disabled={deletingId !== null}
          >
            <Icon name="delete" size={16} />
            <span>Delete</span>
          </button>
        </div>
        {#if deleteError !== null}
          <p class="error" role="alert">{deleteError}</p>
        {/if}
        <!-- The mockups' desk footnote ("ACTION CANNOT BE UNDONE"): quiet
             caps under the actions — true (no undo, DECISIONS.md §4) and
             exclamation-free (§6). -->
        <span class="modal-foot" aria-hidden="true">Action cannot be undone</span>
      </div>
    </div>
  {/if}
</div>

<style>
  /* The body grows to push the footer down (flex:1 comes from the shared
     .sheet-body rule); this adds its internal stack. */
  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  /* Title block + the mockups' dismiss X (a quiet round button carrying
     the close glyph instead of the shared text Close — the aria-label
     keeps the durable "Close" name). */
  .sheet-title-block {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sheet-close {
    flex: none;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    padding: 0;
    font-size: inherit;
    letter-spacing: normal;
  }

  .rows {
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  /* A stack row is a paper slip: transparent until touched, then it
     surfaces as white paper on a hairline edge (§5.4's highlighted rows).
     position: relative anchors each row's absolutely-positioned menu and
     the active row's folded corner. */
  .row {
    position: relative;
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-note);
    transition:
      background-color 120ms var(--ease-lift),
      border-color 120ms var(--ease-lift),
      box-shadow 120ms var(--ease-lift);
  }

  .row:hover,
  .row:focus-within {
    background: var(--paper);
    border-color: var(--paper-edge);
  }

  /* The ACTIVE stack's slip stays surfaced even without hover, with the
     shallowest buried-note shadow lifting it a hair off the drawer. */
  .row.active-row {
    background: var(--paper);
    border-color: var(--paper-edge);
    box-shadow: var(--shadow-note-edge-near);
  }

  /* The §5.4 folded-corner marker on the active row: a small dog-ear
     triangle in the top-right corner, gold (the quiet secondary — the
     vermilion stays reserved for actions). Pure CSS, tokens only. */
  .row.active-row::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    border-top: 0.5rem solid var(--gold-soft);
    border-left: 0.5rem solid transparent;
  }

  /* The §5.4 pictogram: a tiny sticky-note stack — three tilted rounded
     layers (shadow, gold-soft, gold-dim), pure CSS, aria-hidden. */
  .pictogram {
    position: relative;
    flex: none;
    width: 1.5rem;
    height: 1.75rem;
  }

  .pictogram .layer {
    position: absolute;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.125rem;
  }

  .pictogram .back {
    top: 0;
    left: 0;
    background: var(--paper-shade);
    transform: rotate(4deg);
  }

  .pictogram .mid {
    top: 0.125rem;
    left: 0.125rem;
    background: var(--gold-soft);
    transform: rotate(-3deg);
  }

  .pictogram .front {
    top: 0.25rem;
    left: 0.25rem;
    background: var(--gold-dim);
    box-shadow: var(--shadow-note-edge-far);
    transform: rotate(1deg);
  }

  /* The row's ONE main button: switch + identity (name over a quiet
     (N) subline, the active marker trailing it). A column: the prominent
     handwritten-ish name first, the count second (mockup "Work / 8 notes
     • current" — parens kept: e2e asserts the "(N)" shape). */
  .stack-button {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.125rem;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: var(--ink-body);
    font-size: var(--text-body-md);
  }

  .stack-button:disabled {
    cursor: default;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
    max-width: 100%;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  /* The mockups' active presence dot (vermilion, next to the active name —
     stacks_drawer_delete_confirm's "bg-primary" bead). aria-hidden: the
     "— active" tail carries the meaning. */
  .dot {
    flex: none;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--accent);
  }

  .sub {
    color: var(--ink-quiet);
    font-size: var(--text-label-md);
    white-space: nowrap;
  }

  .active {
    color: var(--ink-muted);
    font-size: 0.9rem;
    /* The visible "— active" text stays exactly as written (e2e asserts
       it); the folded-corner visual is the ::after above. */
    white-space: nowrap;
  }

  .kebab {
    flex: none;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    background: none;
    border: none;
    border-radius: var(--radius-note);
    color: var(--ink-quiet);
    cursor: pointer;
    padding: 0;
    transition: color 120ms var(--ease-lift);
  }

  /* Always visible but quiet; hover/focus bring it to full ink. */
  .kebab:hover,
  .row:focus-within .kebab {
    color: var(--ink-body);
    background: var(--paper-shade);
  }

  /* Floating paper card (anchored to the row, above the row contents):
     white paper, hairline edge, the sheet shadow — §5.4's menu without a
     browser-native frame. */
  .menu {
    position: absolute;
    right: 0.25rem;
    top: 100%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-sheet);
    box-shadow: var(--shadow-sheet);
    padding: var(--space-xs);
    min-width: 6rem;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    background: none;
    border: none;
    text-align: left;
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-note);
    cursor: pointer;
    color: var(--ink-body);
    font-size: var(--text-body-md);
  }

  .menu-item:hover {
    background: var(--paper-shade);
  }

  /* The mockups' hairline between the menu's items. */
  .menu-divider {
    height: 1px;
    background: var(--paper-edge);
    margin-inline: var(--space-sm);
  }

  /* Delete leans accent — the destructive item reads as such before the
     confirm modal ever opens; its hover is the quiet accent-soft tint. */
  .menu-item.delete {
    color: var(--accent);
  }

  .menu-item.delete:hover {
    background: var(--accent-soft);
  }

  /* -- Rename inline edit: shared paper slip input + Save chip + ghost
     Cancel (the ListView treatment, same mechanics). */
  .edit {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  /* The rename input takes the space beside Save/Cancel (T28 §9):
     flex:1 + min-width:0 so an 80-char unbroken name (STACK_NAME_MAX_
     LENGTH) can never stretch the row past the sheet. */
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

  /* -- Footer create form: the mockups' "Create new deck" block — a
     visible micro-label over an input row, pinned to the bottom of the
     sheet (it follows the flex:1 body), warm paper with a top hairline.
     Its input shrinks beside the button instead of stretching the row
     (T28 §9); the button is the paper-shade chip with accent ink. */
  .create {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    background: var(--paper-warm);
    border-top: 1px solid var(--paper-edge);
    padding: var(--space-md) var(--space-lg);
  }

  .create-label {
    color: var(--ink-quiet);
    font-size: var(--text-label-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .create-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .create input {
    flex: 1;
    min-width: 0;
  }

  .create-button {
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

  .create-button:disabled {
    color: var(--ink-quiet);
    cursor: default;
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

  /* Confirm modal backdrop over the sheet: the SAME warm ink scrim the
     sheets sit on (color-mix over --ink — evergreen-browsers only,
     DECISIONS.md §11), no blur. The backdrop is position:fixed, so it does
     NOT inherit the overlay's padding — it carries the same gutter itself,
     which is what `min(24rem, 100%)` on .modal below resolves against
     (T28 §9: the modal must fit at 390px, long stack names included). */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 15; /* overlay sheets are 10; App's connection strip is 20 */
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--ink) 10%, transparent);
    padding-inline: var(--gutter);
  }

  /* The modal: a paper card with the sheet shadow and the sheet radius,
     tilted a whisper (-0.75deg — the mockups' hand-placed pinned notice,
     not a grid). */
  .modal {
    position: relative;
    background: var(--paper);
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-sheet);
    box-shadow: var(--shadow-sheet);
    padding: var(--space-xl) var(--space-lg) var(--space-lg);
    transform: rotate(-0.75deg);
    /* Fits at 390px: min() caps at the desktop 26rem and falls back to
       the padded backdrop's width on narrow viewports (T28 §9 — the
       confirm copy names the stack, so the box must never overflow). */
    width: min(26rem, 100%);
    max-width: 26rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
  }

  /* The mockups' vermilion desk tack pinning the notice (a ring + pin
     dot, primary-container over primary-soft — tokens only). */
  .tack {
    position: absolute;
    top: -0.875rem;
    left: 50%;
    translate: -50% 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--accent-soft);
    box-shadow: var(--shadow-input);
    display: grid;
    place-items: center;
  }

  .tack-pin {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
  }

  /* The mockups' tape strip under the tack (a short paper-shade pill). */
  .tape {
    width: 5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: var(--paper-shade);
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
    gap: var(--space-sm);
  }

  /* Cancel: ghost paper button. Delete: the accent stamp. */
  .modal-actions .cancel {
    background: none;
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-note);
    color: var(--ink-body);
    padding: var(--space-xs) var(--space-md);
    cursor: pointer;
  }

  .modal-actions .cancel:hover {
    background: var(--paper-shade);
  }

  .modal-actions .cancel:disabled {
    cursor: default;
    color: var(--ink-quiet);
  }

  .modal-actions .delete {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    background: var(--accent);
    border: none;
    border-radius: var(--radius-note);
    color: var(--on-accent);
    padding: var(--space-xs) var(--space-md);
    cursor: pointer;
    box-shadow: var(--shadow-btn-accent);
  }

  .modal-actions .delete:hover {
    background: var(--accent-hover);
  }

  .modal-actions .delete:disabled {
    cursor: default;
    box-shadow: var(--shadow-btn-accent-active);
  }

  /* The mockups' desk footnote under the actions: whisper-quiet tracked
     caps — true (no undo, DECISIONS.md §4), exclamation-free (§6). Solid
     --ink-quiet (no dimming opacity): the footnote is real copy and keeps
     the quiet-ink AA floor the suite asserts. */
  .modal-foot {
    color: var(--ink-quiet);
    font-size: var(--text-label-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* -- Mobile (≤640px; the breakpoint literal is documented once in
       tokens.css; every repetition cites it): thumb-sized kebab and menu
       controls (the ≥44px hit floor is each control's own box). */
  @media (max-width: 640px) {
    /* The confirm modal's backdrop is position:fixed, so it does NOT
       inherit the sheet's responsive padding — carry the mobile gutter
       pair here too, or the modal would sit 24px inset while the sheet
       sits 12px (the same consistency the base rule documents). */
    .backdrop {
      padding-inline: var(--gutter-mobile);
    }

    .kebab {
      width: 2.75rem;
      height: 2.75rem;
    }

    /* Menu items keep their natural width (text-sized); the 44px floor is
       the min-height, padded comfortable for thumbs. */
    .menu-item {
      min-height: 44px;
      padding: var(--space-sm) var(--space-md);
    }
  }
</style>
