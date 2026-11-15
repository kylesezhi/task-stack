/**
 * DOM-only focus helpers for overlays (T33 slice 2; sources: TASKS.md T33,
 * DESIGN.md §5.3/§5.4 — sheets are dialogs, so keyboard focus belongs to
 * them while they are open and returns where it came from when they close).
 *
 * Framework-light on purpose: plain Svelte actions over the raw DOM, no
 * store imports, no Svelte-reactive reads — web/tests/e2e/zz-a11y.spec.ts
 * exercises them through real overlays. Unit tests are deliberately NOT
 * included here; behavior is asserted end-to-end in the browser where
 * focus, Tab order, and inert actually mean something.
 */
import type { ActionReturn } from "svelte/action";

/**
 * Everything that can take a TAB stop. `[tabindex]:not([tabindex="-1"])`
 * covers positive tabindexes and the tabindex="0" divs; a[href] because
 * links without tabindex are focusable by default. This selector alone is
 * NOT sufficient — isFocusable re-checks each match's live state.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** True when `el` can actually receive focus right now. The selector match
 * above is only half the story; this checks everything that can silently
 * disqualify a matched element:
 * - explicit tabindex="-1" (removed from Tab order on purpose);
 * - [inert] on the element itself or any ancestor (closest includes self);
 * - :disabled — the element's own disabled state AND disabled-fieldset
 *   descendants (a control inside <fieldset disabled> is unfocusable but
 *   carries no disabled attribute of its own);
 * - display:none or visibility:hidden (visibility is inherited, so the
 *   computed style also catches an invisible ancestor);
 * - zero client rects (not rendered / zero size — an invisible Tab stop
 *   that would swallow a keystroke). */
function isFocusable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if (el.closest("[inert]") !== null) return false;
  if (el.matches(":disabled") || el.closest("fieldset:disabled") !== null) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

/** The currently focusable elements inside `container`, in DOM (= Tab)
 * order. querySelectorAll never returns the container itself, and the
 * explicit `el !== container` filter keeps that guarantee stated — the
 * dialog container must never appear in its own Tab list (it is pinned
 * tabindex="-1" by dialogFocus). Exported so menus/overlays can seed or
 * inspect the order without duplicating the selector. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el !== container && isFocusable(el),
  );
}

/** Keeps Tab/Shift+Tab inside `node` (the dialog). Rules:
 * - no focusable children at all → keep focus ON the container (an empty
 *   dialog must not eject focus to the page behind it);
 * - focus on the container itself → Tab goes to the first, Shift+Tab to
 *   the last child;
 * - focus at the first/last child → wraps to the other end;
 * - focus that escaped the dialog entirely (e.g. programmatically moved to
 *   body) never reaches this node-attached listener anyway — a keydown
 *   targeted at <body> bubbles body → html → window without passing
 *   through the dialog. That case is safe by construction, not by
 *   wrapping: while a dialog is open the desk behind it is `inert`
 *   (App.svelte), so the dialog is the only tabbable surface and the
 *   container-level listener below wraps Tab within it. */
function trapTab(node: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = focusableWithin(node);
  const active = document.activeElement;
  const inside = active instanceof Node && node.contains(active);

  if (focusables.length === 0) {
    event.preventDefault();
    node.focus();
    return;
  }

  // Length > 0 is proven above; .at() still types undefined, so narrow
  // once here instead of asserting everywhere below.
  const first = focusables.at(0);
  const last = focusables.at(-1);
  if (first === undefined || last === undefined) return;

  if (!inside || active === node) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  const index = focusables.indexOf(active as HTMLElement);
  if (index === -1) {
    // Focusable (per the browser) but absent from our list — e.g. a control
    // the filter rejected a moment ago. Wrap to the front rather than leak.
    event.preventDefault();
    first.focus();
    return;
  }

  const next = event.shiftKey ? index - 1 : index + 1;
  if (next < 0 || next >= focusables.length) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
  // Otherwise the native order already lands inside — don't interfere.
}

/** Restores focus after a dialog closes: to `target` when it is still
 * connected and not buried in an [inert] subtree (focusing an inert element
 * silently does nothing), otherwise to body as the safe fallback — the
 * browser would drop focus there anyway once the dialog unmounts, so this
 * only makes the intent explicit. Callers may run this in a microtask; the
 * checks here always reflect the live DOM at call time, so they correctly
 * handle a target that is (still or newly) inert. */
function restoreFocus(target: HTMLElement | null): void {
  if (target !== null && target.isConnected && target.closest("[inert]") === null) {
    target.focus();
    return;
  }
  document.body.focus();
}

export interface DialogFocusOptions {
  /** Where to put focus on mount: the container itself (default — a dialog
   * whose contents manage their own reading order), its first focusable
   * child, or a specific element matched by a querySelector INSIDE the
   * node. A selector match is validated with isFocusable — a selector that
   * resolves to a currently-unfocusable element (disabled, hidden, inert)
   * falls back to the first focusable, then the container, so focus is
   * never parked somewhere inert. */
  initialFocus?: "container" | "first" | string;
  /** Where focus returns on destroy. Defaults to the element focused just
   * before the dialog mounted (the trigger button, in practice). */
  returnFocus?: HTMLElement | null;
}

/** Svelte action for dialogs/sheets: focuses on mount, traps Tab while the
 * dialog is open, restores the trigger's focus on destroy. Mount-time focus
 * is applied synchronously — the action runs after the node and its
 * subtree are in the DOM (repo precedent: StackView's focusOnMount), so the
 * initialFocus target is already queryable. */
export function dialogFocus(
  node: HTMLElement,
  options?: DialogFocusOptions,
): ActionReturn<DialogFocusOptions> {
  const initialFocus = options?.initialFocus ?? "container";
  // Explicit returnFocus wins; otherwise remember whoever held focus now,
  // before the dialog's own mount-focus replaces it.
  const requestedReturn = options?.returnFocus ?? null;
  const returnTarget =
    requestedReturn ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  // The container must be focusable to receive (and pin) focus when it has
  // no children; tabindex="-1" keeps it out of the Tab order itself. Only
  // added when absent — a dialog that opted into a real tabindex keeps it,
  // and the attribute is removed again on destroy.
  const addedTabIndex = !node.hasAttribute("tabindex");
  if (addedTabIndex) node.setAttribute("tabindex", "-1");

  let target: HTMLElement;
  if (initialFocus === "first") {
    target = focusableWithin(node)[0] ?? node;
  } else if (initialFocus === "container") {
    target = node;
  } else {
    const matched = node.querySelector<HTMLElement>(initialFocus);
    target =
      matched !== null && isFocusable(matched) ? matched : (focusableWithin(node)[0] ?? node);
  }
  target.focus();

  // Capture phase: a child that stopPropagation()s its own key handling
  // must not be able to disable the trap.
  const onKeyDown = (event: KeyboardEvent): void => trapTab(node, event);
  node.addEventListener("keydown", onKeyDown, true);

  return {
    destroy(): void {
      node.removeEventListener("keydown", onKeyDown, true);
      if (addedTabIndex) node.removeAttribute("tabindex");
      // Deferred one microtask: destroy() runs mid-flush, so an ancestor
      // inerted by this dialog (e.g. the sheet behind a confirm modal, whose
      // `inert={pendingDelete !== null}` binding) may not have been
      // un-inerted yet — restoring synchronously would see the return target
      // inside an [inert] subtree and fall back to body. Letting the flush
      // finish makes the ancestor's real state visible. The guard keeps the
      // deferral safe: if a surface opened during the same flush (or any
      // later focus) already owns focus, leave it alone — only restore when
      // focus is still where the unmount left it (on <body> or nowhere) or
      // still inside the destroyed node.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active !== null && active !== document.body && !node.contains(active)) return;
        restoreFocus(returnTarget);
      });
    },
  };
}

/** Small companion action for menus: focus the first focusable child on
 * mount (the node itself when it has none), then step aside — no trap, no
 * restore; menus close by dismissal, not by unmounting a dialog. */
export function focusFirst(node: HTMLElement): ActionReturn {
  const first = focusableWithin(node)[0] ?? node;
  first.focus();
  return {};
}
