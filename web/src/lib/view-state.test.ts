/**
 * Unit tests for the view state machine (T16) — the full truth table from
 * TASKS.md T16. The machine is pure TS, so these run in Node (see
 * vitest.config.ts: no Svelte imports; the view.ts glue is verified by
 * svelte-check/build and later e2e, T22).
 */
import { describe, expect, it } from "vitest";
import type { AppState } from "@task-stack/shared";
import { OVERLAY_VIEWS, ViewMachine, type ViewName } from "./view-state";

// -- helpers ----------------------------------------------------------------

/** Server invariant (server/src/stacks.ts): activeStackId is null iff there
 * are no stacks — so non-empty snapshots always carry an active pointer. */
const EMPTY: AppState = { activeStackId: null, stacks: [], notes: [], completed: [] };

const POPULATED: AppState = {
  activeStackId: "s1",
  stacks: [{ id: "s1", name: "Work", position: 1, createdAt: "t0" }],
  notes: [],
  completed: [],
};

/** Listener recording both the values it saw and how often it was called. */
function recorder(machine: ViewMachine): {
  seen: ViewName[];
  install: () => () => void;
} {
  const seen: ViewName[] = [];
  const install = (): (() => void) => machine.onChange((view) => seen.push(view));
  return { seen, install };
}

const OVERLAYS = ["list", "drawer", "archive"] as const;

// -- initial value ----------------------------------------------------------

describe("ViewMachine", () => {
  it("starts at firstRun (and any explicit start agrees)", () => {
    expect(new ViewMachine().get()).toBe("firstRun");
    expect(new ViewMachine("firstRun").get()).toBe("firstRun");
    expect(new ViewMachine("stack").get()).toBe("stack");
  });

  it("OVERLAY_VIEWS is exactly the three overlay views", () => {
    expect([...OVERLAY_VIEWS].sort()).toEqual(["archive", "drawer", "list"]);
  });

  // -- open() -------------------------------------------------------------

  it("open() from stack reaches every overlay target", () => {
    for (const target of OVERLAYS) {
      const machine = new ViewMachine("stack");
      const { seen, install } = recorder(machine);
      install();

      machine.open(target);
      expect(machine.get()).toBe(target);
      expect(seen).toEqual([target]);
    }
  });

  it("open() while an overlay is open REPLACES it (never stacks on top)", () => {
    for (const from of OVERLAYS) {
      for (const to of OVERLAYS) {
        const machine = new ViewMachine("stack");
        const { seen, install } = recorder(machine);
        install();
        machine.open(from);

        machine.open(to);
        expect(machine.get()).toBe(to);
        // Re-leading with the same overlay is a no-op (no second notification).
        expect(seen).toEqual(from === to ? [from] : [from, to]);
      }
    }
  });

  it("open() from firstRun is a no-op — navigation cannot leave firstRun", () => {
    const machine = new ViewMachine(); // default firstRun
    const { seen, install } = recorder(machine);
    install();

    for (const target of OVERLAYS) machine.open(target);
    expect(machine.get()).toBe("firstRun");
    expect(seen).toEqual([]); // no-op transitions notify nobody
  });

  it("open() to the already-open overlay is a no-op with no notification", () => {
    const machine = new ViewMachine("stack");
    const { seen, install } = recorder(machine);
    install();

    machine.open("list");
    machine.open("list"); // the drawer button pressed twice, say
    expect(machine.get()).toBe("list");
    expect(seen).toEqual(["list"]);
  });

  // -- closeOverlay() -----------------------------------------------------

  it("closeOverlay() returns every overlay to the desk (stack)", () => {
    for (const target of OVERLAYS) {
      const machine = new ViewMachine("stack");
      machine.open(target);
      const { seen, install } = recorder(machine);
      install();

      machine.closeOverlay();
      expect(machine.get()).toBe("stack");
      expect(seen).toEqual(["stack"]);
    }
  });

  it("closeOverlay() from stack or firstRun is a no-op — nothing to close", () => {
    for (const initial of ["stack", "firstRun"] as const) {
      const machine = new ViewMachine(initial);
      const { seen, install } = recorder(machine);
      install();

      machine.closeOverlay();
      expect(machine.get()).toBe(initial);
      expect(seen).toEqual([]);
    }
  });

  // -- applySnapshot() ----------------------------------------------------

  it("applySnapshot(empty) forces firstRun from every view", () => {
    for (const initial of ["firstRun", "stack", ...OVERLAYS] as const) {
      const machine = new ViewMachine(initial);
      const { seen, install } = recorder(machine);
      install();

      machine.applySnapshot(EMPTY);
      expect(machine.get()).toBe("firstRun");
      // Notify-count regression guard: must flow through set(), not a direct
      // `this.view` write (which would desync the live view store untouched)
      // — firstRun→firstRun is silent, everything else notifies exactly once.
      expect(seen).toEqual(initial === "firstRun" ? [] : ["firstRun"]);
    }
  });

  it("applySnapshot(populated) retires firstRun and leaves other views alone", () => {
    // firstRun → stack: a stack came into being (this client, another tab, curl).
    const fresh = new ViewMachine("firstRun");
    const { seen: freshSeen, install: freshInstall } = recorder(fresh);
    freshInstall();
    fresh.applySnapshot(POPULATED);
    expect(fresh.get()).toBe("stack");
    expect(freshSeen).toEqual(["stack"]); // one notify through set()

    // Every other view is untouched by routine live snapshots (a WS push
    // arriving while the list is open must not close it) — and must not
    // notify either, including the overlay views.
    for (const initial of ["stack", ...OVERLAYS] as const) {
      const machine = new ViewMachine(initial);
      const { seen, install } = recorder(machine);
      install();
      machine.applySnapshot(POPULATED);
      expect(machine.get()).toBe(initial);
      expect(seen).toEqual([]);
    }
  });

  it("absorption: an overlay open when the last stack vanishes is forgotten — stacks returning land on stack", () => {
    const machine = new ViewMachine("stack");
    const { seen, install } = recorder(machine);
    install();

    machine.open("list");
    machine.applySnapshot(EMPTY); // last stack deleted while the list was open
    expect(machine.get()).toBe("firstRun");

    machine.applySnapshot(POPULATED); // stacks reappear — fresh desk, not the stale list
    expect(machine.get()).toBe("stack");
    expect(machine.get()).not.toBe("list");
    // Full notify sequence through set(): list → firstRun → stack, and every
    // transition is an actual change (nothing bypassed, nothing skipped).
    expect(seen).toEqual(["list", "firstRun", "stack"]);
  });

  it("applySnapshot of an equivalent snapshot twice notifies at most once", () => {
    const machine = new ViewMachine("firstRun");
    const { seen, install } = recorder(machine);
    install();

    machine.applySnapshot(EMPTY); // firstRun → firstRun? no change at all
    machine.applySnapshot(EMPTY);
    machine.applySnapshot(POPULATED); // firstRun → stack (one change)
    machine.applySnapshot(POPULATED);

    expect(machine.get()).toBe("stack");
    expect(seen).toEqual(["stack"]);
  });

  it("applySnapshot(empty) from firstRun notifies nobody (already there)", () => {
    const machine = new ViewMachine();
    const { seen, install } = recorder(machine);
    install();

    machine.applySnapshot(EMPTY);
    expect(machine.get()).toBe("firstRun");
    expect(seen).toEqual([]);
  });

  // -- onChange plumbing --------------------------------------------------

  it("multiple listeners all see the same changes; one unsubscribe silences only itself", () => {
    const machine = new ViewMachine("stack");
    const seenA: ViewName[] = [];
    const seenB: ViewName[] = [];
    machine.onChange((view) => seenA.push(view));
    const offB = machine.onChange((view) => seenB.push(view));

    machine.open("drawer");
    offB();
    machine.closeOverlay();

    expect(seenA).toEqual(["drawer", "stack"]);
    expect(seenB).toEqual(["drawer"]);
  });

  it("an onChange listener is never called on a sequence with no actual changes", () => {
    const machine = new ViewMachine("firstRun");
    const { seen, install } = recorder(machine);
    install();

    machine.applySnapshot(EMPTY);
    machine.open("list"); // no-op from firstRun
    machine.closeOverlay(); // nothing to close
    for (const target of OVERLAYS) machine.open(target); // all no-ops

    expect(seen).toEqual([]);
    expect(machine.get()).toBe("firstRun");
  });
});
