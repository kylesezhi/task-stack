import type { Note } from "@task-stack/shared";
import { edgeDrop, edgeOffset, tilt } from "@task-stack/shared";

/**
 * T26's buried-edge mapping (TASKS.md T26; DECISIONS.md §3/§8; DESIGN.md
 * §2/§5.1) — the id→CSS seam sibling of note-style.ts. Peeking edges, the
 * "+N more" scrap, and the depth-graded shadow all derive purely from
 * server-truth inputs (each note's `id` and `position`) — no Math.random,
 * no state — so the same pile renders identically on every reload/device
 * (the T26 done-when's "stable across reload"). Components stay dumb
 * consumers; this stays unit-testable without a DOM.
 *
 * Placement philosophy (DECISIONS.md §3, deliberately NOT the mockup's
 * depth-graded cascade): the mockup shifts each buried note outward with
 * depth — shuffling the pile on every push/pop. We instead freeze each
 * note's offset at its id. Server truth is position (stable across
 * reloads by nature), but position-derived offsets would CHURN on every
 * push/pop — each buried note would slide as notes arrive or leave above
 * it; id-derived placement keeps its exact spot forever (the same
 * side-vs-parity reasoning T23 recorded in DECISIONS.md §3) and always
 * stays inside DESIGN.md §2's fixed 6–10px band. Shadow depth and paint
 * order, by contrast, correctly track POSITION — the pile's looks, not
 * its layout. Same docs-over-mockup precedent as T24's Epilogue→Inter
 * call in tokens.css.
 */

/**
 * DESIGN.md §5.1's visible cap: 15 visible CARDS TOTAL — the top note plus
 * up to 14 buried edges (positions 2–15, the shallowest). TASKS/DECISIONS
 * say "capped ~15 edges"; this reconciles the two via the section's own
 * worked example: 40 notes → 14 edges + "+25 more" scrap, which is only
 * exact as 15 total. Derived constant so the pair can't drift apart.
 */
export const MAX_VISIBLE_NOTE_CARDS = 15;
export const MAX_VISIBLE_EDGES = MAX_VISIBLE_NOTE_CARDS - 1;

/**
 * The notes whose edges peek out of the pile, DEEPEST-FIRST. Takes the
 * active stack's position-ascending notes and returns positions 2..15 in
 * descending order — deepest notes first, because they paint first and sit
 * behind shallower ones; the top card (position 1) is the caller's DOM
 * sibling and paints last. Defensive slice+sort of a copy: the snapshot
 * array is never mutated in place (StackView's "filter FIRST, then sort
 * the copy" rule).
 */
export function peekingEdges(notes: Note[]): Note[] {
  const ascending = [...notes].sort((a, b) => a.position - b.position);
  // Drop the first (the top card — position 1), cap at positions 2..15,
  // then let the cap slice come out REVERSED: deepest-first paint order.
  return ascending.slice(1, MAX_VISIBLE_NOTE_CARDS).reverse();
}

/**
 * Notes the cap hides — the `{hidden} more` scrap's number. 0 until the
 * stack outgrows the visible cap, exactly DESIGN.md §5.1's arithmetic
 * (40 − 15 = 25).
 */
export function hiddenNoteCount(noteCount: number): number {
  return Math.max(0, noteCount - MAX_VISIBLE_NOTE_CARDS);
}

/**
 * Horizontal peek offset in px — signed, magnitude [6, 10) (DESIGN.md §2).
 * Pure passthrough of the shared T23 helper: the seam adds no math, it
 * names the value's purpose.
 */
export function edgeX(id: string): number {
  return edgeOffset(id);
}

/**
 * Vertical drop in px — always positive, magnitude [6, 10): a buried note
 * always sits a little lower than the top note (DESIGN.md §5.1's deep
 * state — the pile's mass grows downward, scrap at the bottom). Passthrough
 * of the shared T26 helper.
 */
export function edgeY(id: string): number {
  return edgeDrop(id);
}

/**
 * Edge rotation in degrees, toward the edge's peek side (the corner swings
 * outward — mockup pattern) and "a little more" than the top card's ±2–6°
 * band: magnitude [4, 8). Sign comes from the peek side, magnitude from the
 * note's own tilt seed plus a fixed 2° bonus, both deterministic per id.
 */
export function edgeTilt(id: string): number {
  return Math.sign(edgeOffset(id)) * (Math.abs(tilt(id)) + 2);
}

/**
 * The buried-edge shadow for a note's POSITION — server truth that
 * legitimately tracks the pile's shape here: the rungs may change on
 * push/pop, by design, because the shadow answers "how deep is this note
 * RIGHT NOW" — unlike the id-derived PLACEMENT, which never churns
 * (edge-style.ts header). Position 1 never reaches here — that note is
 * the top card and wears the T25 `--shadow-note-top`; positions 2–5 →
 * near rung, 6–10 → the existing `--shadow-note-buried` middle rung,
 * 11+ → the far rung.
 */
export function edgeShadowToken(position: number): string {
  if (position >= 11) return "var(--shadow-note-edge-far)";
  if (position >= 6) return "var(--shadow-note-buried)";
  return "var(--shadow-note-edge-near)";
}
