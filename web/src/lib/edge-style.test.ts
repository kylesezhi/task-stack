import type { Note } from "@task-stack/shared";
import { edgeDrop, edgeOffset, tilt } from "@task-stack/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_EDGES,
  MAX_VISIBLE_NOTE_CARDS,
  edgeShadowToken,
  edgeTilt,
  edgeX,
  edgeY,
  hiddenNoteCount,
  peekingEdges,
} from "./edge-style";

/**
 * T26 mapping tests: the web-side seam from note ids/positions → buried-edge
 * CSS values. The hash math and its distributions are pinned in
 * shared/src/random.test.ts; here the contract is the SEAM (same id → same
 * values — the done-when's "stable across reload"), the cap arithmetic
 * (DESIGN.md §5.1: 40 notes → 14 edges + "+25 more"), the deepest-first
 * paint order, and the shadow banding at position boundaries. Fixture ids
 * are fixed uuids, so every expectation below is deterministic forever.
 */

const UUID_NOTE_A = "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e6f";
const UUID_NOTE_B = "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7d";
const UUID_NOTE_C = "f0419e21-77a2-4f99-8e21-b2f4e7c3d902";
const UUID_NOTE_D = "4c1a9f2b-9e3d-4d61-8c9a-e1f7e10a3bb5";
const FIXTURE_IDS = [UUID_NOTE_A, UUID_NOTE_B, UUID_NOTE_C, UUID_NOTE_D];

/** A minimal Note with just what the seam reads: id + position. */
function note(id: string, position: number): Note {
  return {
    id,
    stackId: "stack-1",
    text: "fixed text",
    position,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** 40 notes, positions 1..40 ascending, one id each (fixed, index-derived). */
function fullStack(): Note[] {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: 40 }, (_, i) =>
    note(`pos-${String(i + 1).padStart(3, "0")}-4b3c-4d5e-9f0a-${alpha[i % 26]}`, i + 1),
  );
}

describe("peeking edges seam (T26)", () => {
  it("pins the visible-card cap to DESIGN.md §5.1's arithmetic", () => {
    // 15 TOTAL (top + 14 edges) is what makes the worked example exact:
    // 40 notes → 14 edges + "+25 more". A drift in either constant breaks
    // that example and the e2e pins it end-to-end.
    expect(MAX_VISIBLE_NOTE_CARDS).toBe(15);
    expect(MAX_VISIBLE_EDGES).toBe(14);
  });

  it("cap arithmetic: edges and hidden counts at 1 / 8 / 15 / 16 / 40 notes", () => {
    // DESIGN.md §5.1's three states (1 / 8 / 40) plus the two boundary
    // cases (15 = cap, 16 = first hidden note).
    for (const [count, edges, hidden] of [
      [1, 0, 0],
      [8, 7, 0],
      [15, 14, 0],
      [16, 14, 1],
      [40, 14, 25],
    ] as const) {
      const notes = Array.from({ length: count }, (_, i) =>
        note(`edge-cap-${i}-4b3c-4d5e-9f0a-0000000000aa`, i + 1),
      );
      expect(peekingEdges(notes)).toHaveLength(edges);
      expect(hiddenNoteCount(count)).toBe(hidden);
    }
  });

  it("orders edges DEEPEST-FIRST (paint order: deeper behind shallower)", () => {
    // 40-note stack: positions 15..2 (the shallowest 14, farthest-first);
    // position 1 is the top card, position 16+ hide behind the scrap.
    const deep = peekingEdges(fullStack());
    expect(deep.map((n) => n.position)).toEqual(
      Array.from({ length: MAX_VISIBLE_EDGES }, (_, i) => 15 - i),
    );
    // 8-note stack: 8..2, all seven edges present.
    const eight = Array.from({ length: 8 }, (_, i) =>
      note(`edge-8-${i}-4b3c-4d5e-9f0a-0000000000aa`, i + 1),
    );
    expect(peekingEdges(eight).map((n) => n.position)).toEqual([8, 7, 6, 5, 4, 3, 2]);
  });

  it("never mutates the input array (snapshot discipline)", () => {
    // StackView passes a filtered-and-sorted copy, but the seam must also
    // promise the array it receives stays pristine — and the promise only
    // bites when the input is NOT already in the shape the seam wants:
    // feed it REVERSED (deepest-first, the opposite of the documented
    // position-ascending contract) and require its order to be untouched
    // while the output still comes out correctly deepest-first.
    const notes = fullStack().reverse();
    const before = notes.map((n) => n.position);
    const edges = peekingEdges(notes);
    expect(notes.map((n) => n.position)).toEqual(before);
    expect(edges.map((n) => n.position)).toEqual(
      Array.from({ length: MAX_VISIBLE_EDGES }, (_, i) => 15 - i),
    );
  });

  it("determinism: same id → same x/y/tilt, second call equal", () => {
    for (const id of FIXTURE_IDS) {
      expect(edgeX(id)).toBe(edgeX(id));
      expect(edgeY(id)).toBe(edgeY(id));
      expect(edgeTilt(id)).toBe(edgeTilt(id));
    }
  });

  it("bounds: |x| in [6, 10), y in [6, 10) and strictly positive", () => {
    for (const id of FIXTURE_IDS) {
      const x = edgeX(id);
      const y = edgeY(id);
      expect(Math.abs(x)).toBeGreaterThanOrEqual(6);
      expect(Math.abs(x)).toBeLessThan(10);
      // One-sided by design (DESIGN.md §2/§5.1): a buried note always sits
      // below the top — never 0, never negative.
      expect(y).toBeGreaterThan(0);
      expect(y).toBeGreaterThanOrEqual(6);
      expect(y).toBeLessThan(10);
    }
  });

  it("bounds: |tilt| in [4, 8) and strictly MORE than the top card's tilt", () => {
    for (const id of FIXTURE_IDS) {
      const edge = Math.abs(edgeTilt(id));
      expect(edge).toBeGreaterThanOrEqual(4);
      expect(edge).toBeLessThan(8);
      // "A little more" than the top card's ±2–6° band, per T26's brief.
      expect(edge).toBeGreaterThan(Math.abs(tilt(id)));
    }
  });

  it("tilt direction follows the peek side (corner swings outward)", () => {
    // Mockup pattern: an edge peeking LEFT leans left, right leans right —
    // sign(edgeOffset) drives sign(edgeTilt) for every fixture.
    for (const id of FIXTURE_IDS) {
      expect(Math.sign(edgeTilt(id))).toBe(Math.sign(edgeOffset(id)));
    }
  });

  it("x/y are passthroughs of the shared helpers (the seam adds no math)", () => {
    for (const id of FIXTURE_IDS) {
      expect(edgeX(id)).toBe(edgeOffset(id));
      expect(edgeY(id)).toBe(edgeDrop(id));
    }
  });

  it("shadow banding at the array-position boundaries", () => {
    // Rungs: 2–5 near · 6–10 buried (the existing middle token) · 11+ far.
    // 1 is asserted absent: that note wears --shadow-note-top as the top
    // card and never reaches this seam.
    const bands: Array<[number, string]> = [
      [2, "var(--shadow-note-edge-near)"],
      [5, "var(--shadow-note-edge-near)"],
      [6, "var(--shadow-note-buried)"],
      [10, "var(--shadow-note-buried)"],
      [11, "var(--shadow-note-edge-far)"],
      [15, "var(--shadow-note-edge-far)"],
      [40, "var(--shadow-note-edge-far)"],
    ];
    for (const [position, token] of bands) {
      expect(edgeShadowToken(position)).toBe(token);
    }
  });
});
