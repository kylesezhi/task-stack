import { describe, expect, it } from "vitest";
import type { Note } from "@task-stack/shared";
import { DepartureTracker } from "./departure";

/**
 * T29/T30 departure-detection tests (sources: TASKS.md T29/T30, DESIGN.md
 * §5.2/§7, DECISIONS.md §3/§4). The contract is the destructor analysis in
 * the tracker's header: exactly two writes remove the top note of the same
 * stack — a COMPLETE (its id lands in completed[]) and a TOSS (it does
 * not) — and the completed[] lookup is the discriminator between the two
 * ceremonies (fire vs. no fire). Every other mutation — push, reorder,
 * edit, a mid-list toss, the duplicate WS rebroadcast, an emptied pile, a
 * stack switch — must observe its way back to "none" (or "reset"). A
 * fresh tracker per test keeps the one stateful instance the test-under-
 * test rather than a shared channel (push-land.test.ts precedent).
 */

/** Minimal Note fixture — the tracker reads id/position ordering only, but
 * the tracker hands the WHOLE note to whichever ghost plays it, so
 * fixtures are real. */
function note(id: string, position: number): Note {
  return {
    id,
    stackId: DESK,
    text: `note ${id.slice(-2)}`,
    position,
    createdAt: "2026-10-27T09:00:00.000Z",
  };
}

const A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12";
const C = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13";
const DESK = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666677-8888-9999-0000-111111112222";

/** Top-first piles, the way StackView's stackNotes derived arrives. */
function pile(...ids: string[]): Note[] {
  return ids.map((id, index) => note(id, index + 1));
}

function completed(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

describe("DepartureTracker (T29/T30)", () => {
  it("first observation of a stack is a reset — mount/reload is no ceremony", () => {
    const tracker = new DepartureTracker();
    expect(tracker.observe(DESK, pile(B, A), completed())).toEqual({ kind: "reset" });
  });

  it("a completed top note pops, returning the departed note and the reveal", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    const observation = tracker.observe(DESK, pile(A), completed(B));
    expect(observation.kind).toBe("pop");
    if (observation.kind !== "pop") throw new Error("unreachable");
    // The ghost gets the note object as it was on the desk…
    expect(observation.note.id).toBe(B);
    expect(observation.note.text).toBe(`note ${B.slice(-2)}`);
    // …and the reveal targets the note that surfaced beneath it.
    expect(observation.revealedId).toBe(A);
  });

  it("popping the LAST note fires with a null reveal (empty desk beneath)", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(A), completed());
    const observation = tracker.observe(DESK, pile(), completed(A));
    expect(observation).toEqual({ kind: "pop", note: note(A, 1), revealedId: null });
  });

  it("a tossed top note returns a toss — departed, unarchived, note + reveal", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // B left the pile and completed[] did NOT gain it: the quiet toss.
    const observation = tracker.observe(DESK, pile(A), completed());
    expect(observation.kind).toBe("toss");
    if (observation.kind !== "toss") throw new Error("unreachable");
    // The ghost gets the note object as it last sat on the desk…
    expect(observation.note.id).toBe(B);
    expect(observation.note.text).toBe(`note ${B.slice(-2)}`);
    // …and the uncovered note is reported (StackView just never spends it).
    expect(observation.revealedId).toBe(A);
  });

  it("tossing the LAST note fires a toss with a null reveal (empty desk beneath)", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(A), completed());
    // The completed set stays ABSENT of A: a toss, not a pop — even though
    // the pile emptied the same way it does on a pop.
    expect(tracker.observe(DESK, pile(), completed())).toEqual({
      kind: "toss",
      note: note(A, 1),
      revealedId: null,
    });
  });

  it("the duplicate WS rebroadcast after a TOSS does not re-fire", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(A), completed()).kind).toBe("toss");
    // Every mutation flings the snapshot twice (HTTP response + WS
    // broadcast); the second copy must observe to none.
    expect(tracker.observe(DESK, pile(A), completed())).toEqual({ kind: "none" });
  });

  it("a mid-list toss (top unchanged) is none", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A, C), completed());
    // The API tosses by id; a buried note leaving (no archive row) while
    // the top stays put changes nothing the desk shows — no ceremony.
    expect(tracker.observe(DESK, pile(B, C), completed())).toEqual({ kind: "none" });
  });

  it("a push buries the top — still present, so none", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(C, B, A), completed())).toEqual({ kind: "none" });
  });

  it("a reorder that hands the top elsewhere keeps every id — none", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A, C), completed());
    expect(tracker.observe(DESK, pile(A, B, C), completed())).toEqual({ kind: "none" });
  });

  it("an edit (same pile, same order) is none", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(B, A), completed())).toEqual({ kind: "none" });
  });

  it("a mid-list completion (top untouched) is none", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A, C), completed());
    // The API completes by id; a buried note leaving for the archive while
    // the top stays put changes nothing the desk shows — no ceremony.
    expect(tracker.observe(DESK, pile(B, C), completed(A))).toEqual({ kind: "none" });
  });

  it("the duplicate WS rebroadcast of one snapshot does NOT re-fire the pop", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(A), completed(B)).kind).toBe("pop");
    // Every mutation flings the snapshot twice (HTTP response + WS
    // broadcast); the second copy must observe to none.
    expect(tracker.observe(DESK, pile(A), completed(B))).toEqual({ kind: "none" });
  });

  it("a stack switch resets — and clears any pending ceremony by contract", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // B departed (unarchived — a toss) WHILE the user switched desks: the
    // observation is of ANOTHER stack, so it is nobody's ceremony.
    expect(tracker.observe(OTHER, pile(C), completed())).toEqual({ kind: "reset" });
    // …and the reset re-arms: a ceremony on the new desk fires normally.
    expect(tracker.observe(OTHER, pile(), completed(C)).kind).toBe("pop");
  });

  it("a switch DURING a gap where the old desk popped: still just a reset", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // The old desk's top left for the archive while we looked away, but the
    // observation is of ANOTHER stack — piles never compare across stacks.
    expect(tracker.observe(OTHER, pile(A), completed(B))).toEqual({ kind: "reset" });
  });

  it("a toss discovered after a reconnect gap fires once, for the net effect", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // BOTH notes were tossed while disconnected (no archive rows): one
    // toss ceremony, for the departed top we last saw, revealing the
    // CURRENT top — same philosophy as push-land's "push after a gap" and
    // the pop-variant below.
    const observation = tracker.observe(DESK, pile(C), completed());
    expect(observation.kind).toBe("toss");
    if (observation.kind !== "toss") throw new Error("unreachable");
    expect(observation.note.id).toBe(B);
    expect(observation.revealedId).toBe(C);
  });

  it("a pop discovered after a reconnect gap fires once, for the net effect", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // Both A and B were completed while disconnected: one ceremony, the
    // departed top we last saw, and the CURRENT top as the reveal.
    const observation = tracker.observe(DESK, pile(C), completed(A, B));
    expect(observation.kind).toBe("pop");
    if (observation.kind !== "pop") throw new Error("unreachable");
    expect(observation.note.id).toBe(B);
    expect(observation.revealedId).toBe(C);
  });

  it("a MIXED gap (pop + toss) answers ONE ceremony, for the last-seen TOP", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // While disconnected BOTH notes left, different ways: A was completed
    // (its id IS in completed[]) and B — the top we last saw — was tossed
    // (it is NOT). The tracker answers for the last-seen top's own fate,
    // exactly once: B absent from completed[] makes the answer a toss,
    // revealing the CURRENT top (the archived A gets no second ceremony —
    // the tracker compares against the previous observation, never the
    // whole snapshot).
    const observation = tracker.observe(DESK, pile(C), completed(A));
    expect(observation.kind).toBe("toss");
    if (observation.kind !== "toss") throw new Error("unreachable");
    expect(observation.note.id).toBe(B);
    expect(observation.revealedId).toBe(C);
    // …and the mirror case holds by the same rule: if the last-seen TOP
    // is the one archived, the mixed gap is a pop (kept terse by the
    // pure pop-gap test above — completed(A, B) versus completed(A)).
  });

  it("an emptied pile observed twice is none (nothing departed between them)", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(A), completed());
    expect(tracker.observe(DESK, pile(), completed(A)).kind).toBe("pop");
    expect(tracker.observe(DESK, pile(), completed(A))).toEqual({ kind: "none" });
  });

  it("a pile emptied by a TOSS observed twice is none (duplicate rebroadcast)", () => {
    const tracker = new DepartureTracker();
    tracker.observe(DESK, pile(A), completed());
    expect(tracker.observe(DESK, pile(), completed()).kind).toBe("toss");
    // The rebroadcast re-observes the same emptied pile — no second ghost.
    expect(tracker.observe(DESK, pile(), completed())).toEqual({ kind: "none" });
  });
});
