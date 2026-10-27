import { colorIndex, tilt } from "@task-stack/shared";
import { describe, expect, it } from "vitest";
import { NOTE_PALETTE_SIZE, noteColorVar, noteTilt } from "./note-style";

/**
 * T25 mapping tests: the web-side seam from note id → card CSS values. The
 * hash math and its distributions are pinned in shared/src/random.test.ts;
 * here the contract is the SEAM — same id → same values (the done-when's
 * "reload → identical placement for the same note ids"), tilt bounds kept
 * through the passthrough, and colors always resolving to one of the 8
 * palette slots tokens.css guards. Fixture ids are fixed uuids, so every
 * expectation below is deterministic forever — a regression in shared/random
 * or this module changes a concrete value and fails loudly.
 */

/** Distinct, realistic uuids (same shape shared/random.test.ts sweeps). */
const FIXTURE_IDS = [
  "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c01",
  "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c02",
  "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c03",
  "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c04",
  "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e6f",
  "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e70",
  "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e71",
  "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7d",
  "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7e",
  "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7f",
  "c37f8e9a-1d20-4b3c-8e5a-6f7a8b9c0d1e",
  "c37f8e9a-1d20-4b3c-8e5a-6f7a8b9c0d1f",
  "d48a0f1b-2e31-4c4d-9f6b-7a8b9c0d1e2f",
  "d48a0f1b-2e31-4c4d-9f6b-7a8b9c0d1e30",
  "e59b1a2c-3f42-4d5e-8a7c-9b0c1d2e3f4a",
  "e59b1a2c-3f42-4d5e-8a7c-9b0c1d2e3f4b",
];

describe("note card style mapping (T25)", () => {
  it("pins the palette size to the 8 tokens tokens.css guards", () => {
    // The token pin test enforces --note-{0..7} EXACTLY; this must name the
    // same number or colorIndex picks a slot that cannot exist.
    expect(NOTE_PALETTE_SIZE).toBe(8);
  });

  it("tilt: same id → same degrees, passthrough keeps the [2, 6) magnitude", () => {
    for (const id of FIXTURE_IDS) {
      const value = noteTilt(id);
      // The seam never re-derives anything — it forwards the shared value.
      expect(value).toBe(tilt(id));
      // DESIGN.md §2 bounds hold through the mapping.
      expect(Math.abs(value)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(value)).toBeLessThan(6);
      // Stability across calls = "reload → identical placement".
      expect(noteTilt(id)).toBe(value);
    }
    // The fixtures lean both ways (the hash is sign-balanced; random.test.ts
    // pins the distribution, this pins that the sample isn't one-sided).
    const signs = new Set(FIXTURE_IDS.map((id) => Math.sign(noteTilt(id))));
    expect(signs).toEqual(new Set([1, -1]));
  });

  it("color: always one of the 8 pinned var slots, stable per id", () => {
    for (const id of FIXTURE_IDS) {
      const value = noteColorVar(id);
      expect(value).toMatch(/^var\(--note-[0-7]\)$/);
      expect(value).toBe(`var(--note-${colorIndex(id, NOTE_PALETTE_SIZE)})`);
      expect(noteColorVar(id)).toBe(value);
    }
  });

  it("distinct ids spread across the palette (not one accidental color)", () => {
    // Deterministic forever for these fixed ids — if a future change collapses
    // the mapping onto one slot, the stack stops feeling hand-placed.
    const vars = new Set(FIXTURE_IDS.map((id) => noteColorVar(id)));
    expect(vars.size).toBeGreaterThan(1);
  });
});
