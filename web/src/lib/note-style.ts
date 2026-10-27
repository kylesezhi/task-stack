import { colorIndex, tilt } from "@task-stack/shared";

/**
 * T25's deterministic note-card mapping (TASKS.md T25; DECISIONS.md §3/§8;
 * DESIGN.md §2): every note's tilt and palette color derive purely from its
 * id via the shared T23 helpers — no Math.random, no state — so the same id
 * renders the same card forever, across reloads, devices, and WS
 * re-broadcasts (the T25 done-when's "reload → identical placement"). This
 * module is the only place that knows how those values become CSS;
 * components stay dumb consumers, and this stays unit-testable without a
 * DOM. Distributions (sign balance, magnitude bounds, palette spread of the
 * hash itself) are pinned in shared/src/random.test.ts — this file owns only
 * the id → CSS-value seam.
 */

/**
 * The palette size tokens.css pins: EXACTLY 8 `--note-{0..7}` tokens, and the
 * guard test (tokens.test.ts) fails any drift — count, order, or hex. The
 * index IS the contract, so this constant is the wiring between the shared
 * hash pick and the token names.
 */
export const NOTE_PALETTE_SIZE = 8;

/**
 * The card's rotation in degrees (sign = lean direction, magnitude in
 * [2, 6) per DESIGN.md §2 — "never a perfect stack, never a card grid").
 */
export function noteTilt(id: string): number {
  return tilt(id);
}

/**
 * The card's background as a token REFERENCE — `var(--note-{i})`, always one
 * of the 8 pinned slots. Returning the var() string (never a resolved
 * color) keeps the token indirection intact: a palette tweak happens in
 * tokens.css and nowhere else.
 */
export function noteColorVar(id: string): string {
  return `var(--note-${colorIndex(id, NOTE_PALETTE_SIZE)})`;
}
