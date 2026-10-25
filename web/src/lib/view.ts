/**
 * Thin Svelte reactive layer over the pure ViewMachine (T16), mirroring how
 * store.ts wraps StateClient: a module-scope machine singleton whose single
 * value is mirrored into a writable store, plus the two helpers components
 * use for navigation. Browser-only plumbing like store.ts (it imports the
 * started client; store.ts touches `location` at module scope) — correctness
 * of the machine itself is unit-tested in view-state.test.ts; this glue is
 * verified by svelte-check, the build, and later e2e (T22).
 */
import { writable } from "svelte/store";
import { client } from "./store";
import { ViewMachine, type OverlayTarget, type ViewName } from "./view-state";

const machine = new ViewMachine();

/** The one active view. Server truth flows in via onSnapshot; navigation
 * flows in via the helpers below — one value, one pipe, like snapshot. */
export const view = writable<ViewName>(machine.get());

// Pipe (order matters within an event only in that applySnapshot must not
// run mid-notification; the two registrations are independent streams):
client.onSnapshot((s) => machine.applySnapshot(s));
machine.onChange((v) => view.set(v));

/** Opens an overlay (list / drawer / archive). No-op from firstRun. */
export function openView(target: OverlayTarget): void {
  machine.open(target);
}

/** Closes the open overlay back to the desk; a no-op when none is open. */
export function closeOverlay(): void {
  machine.closeOverlay();
}
