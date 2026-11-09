import { describe, expect, it } from "vitest";
import type { Note } from "@task-stack/shared";
import { PopCeremonyTracker } from "./pop-ceremony";

/**
 * T29 ceremony-detection tests (sources: TASKS.md T29, DESIGN.md §5.2/§7,
 * DECISIONS.md §3/§4). The contract is the destructor analysis in the
 * tracker's header: only a COMPLETE removes the top note of the same stack
 * AND archives its id, so every other mutation — push, reorder, edit, toss,
 * the duplicate WS rebroadcast, an emptied pile, a stack switch — must
 * observe its way back to "none" (or "reset"). A fresh tracker per test
 * keeps the one stateful instance a test-under-test rather than a shared
 * channel (push-land.test.ts precedent).
 */

/** Minimal Note fixture — the tracker reads id/position ordering only, but
 * the pop return hands the WHOLE note to the ghost, so fixtures are real. */
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

describe("PopCeremonyTracker (T29)", () => {
  it("first observation of a stack is a reset — mount/reload is not a pop", () => {
    const tracker = new PopCeremonyTracker();
    expect(tracker.observe(DESK, pile(B, A), completed())).toEqual({ kind: "reset" });
  });

  it("a completed top note pops, returning the departed note and the reveal", () => {
    const tracker = new PopCeremonyTracker();
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
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(A), completed());
    const observation = tracker.observe(DESK, pile(), completed(A));
    expect(observation).toEqual({ kind: "pop", note: note(A, 1), revealedId: null });
  });

  it("a tossed top note is NOT a pop — no archive row, no fire (§4; T30's hook)", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(A), completed())).toEqual({ kind: "none" });
  });

  it("a push buries the top — still present, so none", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(C, B, A), completed())).toEqual({ kind: "none" });
  });

  it("a reorder that hands the top elsewhere keeps every id — none", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A, C), completed());
    expect(tracker.observe(DESK, pile(A, B, C), completed())).toEqual({ kind: "none" });
  });

  it("an edit (same pile, same order) is none", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(B, A), completed())).toEqual({ kind: "none" });
  });

  it("a mid-list completion (top untouched) is none", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A, C), completed());
    // The API completes by id; a buried note leaving for the archive while
    // the top stays put changes nothing the desk shows — no ceremony.
    expect(tracker.observe(DESK, pile(B, C), completed(A))).toEqual({ kind: "none" });
  });

  it("the duplicate WS rebroadcast of one snapshot does NOT re-fire the pop", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(DESK, pile(A), completed(B)).kind).toBe("pop");
    // Every mutation flings the snapshot twice (HTTP response + WS
    // broadcast); the second copy must observe to none.
    expect(tracker.observe(DESK, pile(A), completed(B))).toEqual({ kind: "none" });
  });

  it("a stack switch resets — and clears any stale ceremony by contract", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    expect(tracker.observe(OTHER, pile(C), completed())).toEqual({ kind: "reset" });
    // …and the reset re-arms: a pop on the new desk fires normally.
    expect(tracker.observe(OTHER, pile(), completed(C)).kind).toBe("pop");
  });

  it("a switch DURING a gap where the old desk popped: still just a reset", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // The old desk's top left for the archive while we looked away, but the
    // observation is of ANOTHER stack — piles never compare across stacks.
    expect(tracker.observe(OTHER, pile(A), completed(B))).toEqual({ kind: "reset" });
  });

  it("a pop discovered after a reconnect gap fires once, for the net effect", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(B, A), completed());
    // Both A and B were completed while disconnected: one ceremony, the
    // departed top we last saw, and the CURRENT top as the reveal.
    const observation = tracker.observe(DESK, pile(C), completed(A, B));
    expect(observation.kind).toBe("pop");
    if (observation.kind !== "pop") throw new Error("unreachable");
    expect(observation.note.id).toBe(B);
    expect(observation.revealedId).toBe(C);
  });

  it("an emptied pile observed twice is none (nothing departed between them)", () => {
    const tracker = new PopCeremonyTracker();
    tracker.observe(DESK, pile(A), completed());
    expect(tracker.observe(DESK, pile(), completed(A)).kind).toBe("pop");
    expect(tracker.observe(DESK, pile(), completed(A))).toEqual({ kind: "none" });
  });
});
