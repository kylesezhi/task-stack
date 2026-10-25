/**
 * Framework-free view state machine (T16; sources: TASKS.md T16,
 * DESIGN.md §5.1–5.6, DECISIONS.md §3/§11).
 *
 * Views are views, not URLs (PLAN.md "Frontend structure"): exactly ONE view
 * name is active at a time. `firstRun` and `stack` are base states; the rest
 * are overlays that close back to `stack` (Esc or a Close control) and
 * replace — never stack on top of — one another.
 *
 * `firstRun` is owned by server truth alone: forced whenever the snapshot has
 * no stacks (the server guarantees activeStackId is null iff stacks is
 * empty), dismissed the moment a stack exists — from this client, another
 * tab, or curl. User navigation can never enter or leave it, and any overlay
 * open when the last stack disappears is *forgotten* (absorption): the
 * machine holds one resolved value, not a stacking history.
 *
 * Framework-free and DOM-free (imports only the AppState type) so it loads in
 * Node under vitest; the Svelte glue lives in view.ts.
 */
import type { AppState } from "@task-stack/shared";

/** The five screens of DESIGN.md §4, as one flat view name. */
export type ViewName = "firstRun" | "stack" | "list" | "drawer" | "archive";

/** Overlay views sit on top of the desk and close back to `stack`. */
export const OVERLAY_VIEWS: ReadonlySet<ViewName> = new Set(["list", "drawer", "archive"]);

/** What you may pass to open() — the overlays only (self-maintaining). */
export type OverlayTarget = Exclude<ViewName, "firstRun" | "stack">;

export class ViewMachine {
  private view: ViewName;
  private readonly listeners = new Set<(view: ViewName) => void>();

  constructor(initial: ViewName = "firstRun") {
    this.view = initial;
  }

  get(): ViewName {
    return this.view;
  }

  /** Opens an overlay; `firstRun` no-ops defensively (it has no chrome —
   * DESIGN.md §5.5 — so nothing there could legitimately call this). */
  open(target: OverlayTarget): void {
    if (this.view === "firstRun") return;
    this.set(target);
  }

  /** Closes the open overlay back to the desk; from a base state, a no-op. */
  closeOverlay(): void {
    if (!OVERLAY_VIEWS.has(this.view)) return;
    this.set("stack");
  }

  /** Server truth: an empty stacks array forces firstRun (the last stack may
   * be deleted elsewhere); a firstRun with stacks present becomes the desk.
   * Anything else keeps the current view — live updates under an open
   * overlay must not steal it. */
  applySnapshot(snapshot: AppState): void {
    if (snapshot.stacks.length === 0) {
      this.set("firstRun");
    } else if (this.view === "firstRun") {
      this.set("stack");
    }
  }

  /** Returns an unsubscribe function; listeners are notified synchronously,
   * and only when the value actually changes (no-op transitions are silent,
   * mirroring StateClient's setStatus dedupe). */
  onChange(listener: (view: ViewName) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: ViewName): void {
    if (this.view === next) return;
    this.view = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
