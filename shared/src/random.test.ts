import { describe, expect, it } from "vitest";
import { colorIndex, edgeOffset, tilt } from "./index.js";

/**
 * Realistic uuid literals (style matches validation.test.ts). Reused in
 * several describes below via the FIXTURE_IDS array.
 */
const UUID_NOTE_TOP = "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e6f";
const UUID_NOTE_BOT = "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7d";
const UUID_STACK = "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c01";
const UUID_NOTE_C = "f0419e21-77a2-4f99-8e21-b2f4e7c3d902";
const UUID_NOTE_D = "4c1a9f2b-9e3d-4d61-8c9a-e1f7e10a3bb5";

/**
 * Ids rendered for a note. The hashers accept any string (empty included —
 * the server mints uuids, but `shared` must not couple to that format), so a
 * deliberately non-uuid fixture and "" belong in every per-id loop.
 */
const NON_UUID_ID = "stack-1";
const EMPTY_ID = "";
const FIXTURE_IDS = [
  UUID_NOTE_TOP,
  UUID_NOTE_BOT,
  UUID_STACK,
  UUID_NOTE_C,
  UUID_NOTE_D,
  NON_UUID_ID,
  EMPTY_ID,
];

/**
 * Deterministic uuid-shaped id soup for distribution sweeps — indexed hex
 * segments, no Math.random/crypto, so failures reproduce exactly. 160 is
 * comfortably over the 100 minimum and lets assertions like "every color
 * bucket is hit" mean something.
 */
const SWEEP_IDS: string[] = Array.from({ length: 160 }, (_, i) => {
  const hex = i.toString(16);
  return `note-${hex.padStart(8, "0")}-4b3c-4d5e-9f0a-${hex.padStart(12, "0")}`;
});

describe("tilt", () => {
  it("returns the same value on every call for a reused id", () => {
    // Stability first: the whole point is reload/device invariance with zero
    // storage, so a second call must agree bit-for-bit with the first.
    expect(tilt(UUID_NOTE_TOP)).toBe(tilt(UUID_NOTE_TOP));
    expect(tilt(UUID_NOTE_BOT)).toBe(tilt(UUID_NOTE_BOT));
  });

  it("matches the pinned regression values for fixed uuid literals", () => {
    // Literal pins copied from a known-good run — they fail loudly if anyone
    // touches the hash stream, seeds, or range mapping, which would silently
    // re-lean every existing note.
    expect(tilt(UUID_NOTE_TOP)).toBe(2.93365478515625);
    expect(tilt(UUID_NOTE_BOT)).toBe(5.84930419921875);
    expect(tilt(UUID_NOTE_C)).toBe(4.2056884765625);
    expect(tilt(UUID_NOTE_D)).toBe(-4.97015380859375);
  });

  it.each(FIXTURE_IDS)("stays within ±2–6° for id %s", (id) => {
    // Also asserts finiteness — NaN would pass regular bounds checks and
    // would slip past a naive `>= 2` assertion, so check it explicitly.
    const value = tilt(id);
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(value)).toBeLessThanOrEqual(6);
  });

  it.each(SWEEP_IDS)("stays within ±2–6° across the sweep for id %s", (id) => {
    const value = tilt(id);
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(value)).toBeLessThanOrEqual(6);
  });

  it("leans in both directions across fixtures", () => {
    // A single random sign seed or a hardcoded lean would make every note
    // tilt the same way; at least one fixture must go each way.
    const signs = FIXTURE_IDS.map((id) => Math.sign(tilt(id)));
    expect(new Set(signs).size).toBe(2);
  });
});

describe("edgeOffset", () => {
  it("returns the same value on every call for a reused id", () => {
    expect(edgeOffset(UUID_NOTE_TOP)).toBe(edgeOffset(UUID_NOTE_TOP));
    expect(edgeOffset(UUID_NOTE_C)).toBe(edgeOffset(UUID_NOTE_C));
  });

  it("matches the pinned regression values for fixed uuid literals", () => {
    // Same rationale as the tilt pins — guard the algorithm, not the intent.
    expect(edgeOffset(UUID_NOTE_TOP)).toBe(-9.86773681640625);
    expect(edgeOffset(UUID_NOTE_BOT)).toBe(9.76824951171875);
    expect(edgeOffset(UUID_NOTE_C)).toBe(7.00079345703125);
    expect(edgeOffset(UUID_NOTE_D)).toBe(-9.574462890625);
  });

  it.each([...FIXTURE_IDS, ...SWEEP_IDS])("stays within ±6–10px for id %s", (id) => {
    const value = edgeOffset(id);
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value)).toBeGreaterThanOrEqual(6);
    expect(Math.abs(value)).toBeLessThanOrEqual(10);
  });

  it("peeks on both sides across fixtures", () => {
    // Buried edges must not all hog one side of the center line; but neither
    // do we pin parity — side is per-note and stable (DECISIONS.md §3), so
    // mixed signs across a few ids is exactly what should hold.
    const signs = FIXTURE_IDS.map((id) => Math.sign(edgeOffset(id)));
    expect(new Set(signs).size).toBe(2);
  });
});

describe("colorIndex", () => {
  it("matches the pinned regression values for fixed uuid literals", () => {
    // Same rationale as the tilt/edgeOffset pins — guards the color seed
    // and stream, not the intent. A typo in the `task-stack:color` seed
    // string or a change to the hashing would silently recolor every
    // existing note while every distribution test below stayed green.
    expect(colorIndex(UUID_NOTE_TOP, 4)).toBe(1);
    expect(colorIndex(UUID_NOTE_TOP, 5)).toBe(0);
    expect(colorIndex(UUID_NOTE_BOT, 4)).toBe(2);
    expect(colorIndex(UUID_NOTE_BOT, 5)).toBe(3);
    expect(colorIndex(UUID_NOTE_C, 4)).toBe(1);
    expect(colorIndex(UUID_NOTE_C, 5)).toBe(1);
    expect(colorIndex(UUID_NOTE_D, 4)).toBe(3);
    expect(colorIndex(UUID_NOTE_D, 5)).toBe(2);
  });

  it.each(FIXTURE_IDS)("stays in [0, n) for id %s", (id) => {
    for (const n of [1, 2, 4, 5]) {
      const index = colorIndex(id, n);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(n);
    }
  });

  it.each(SWEEP_IDS)("stays in [0, n) across the sweep for id %s", (id) => {
    for (const n of [1, 2, 4, 5]) {
      const index = colorIndex(id, n);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(n);
    }
  });

  it("always picks index 0 when the palette has a single entry", () => {
    // Modulo of anything by 1 is 0, but pin it so the degenerate palette works.
    for (const id of [...FIXTURE_IDS, ...SWEEP_IDS]) {
      expect(colorIndex(id, 1)).toBe(0);
    }
  });

  it.each([4, 5])("distributes the sweep across every bucket for n = %i", (n) => {
    // Full coverage is a deterministic fact (the sweep is fixed), not a
    // statistical hope — no flakiness is possible here.
    const buckets = new Set(SWEEP_IDS.map((id) => colorIndex(id, n)));
    expect(buckets.size).toBe(n);
  });

  it("rejects a zero palette size", () => {
    expect(() => colorIndex(UUID_NOTE_TOP, 0)).toThrow(RangeError);
  });

  it("rejects negative and non-integer palette sizes", () => {
    // A fractional or negative size cannot index a palette; failing loudly
    // beats a silent modulo wrinkle hiding a caller bug.
    expect(() => colorIndex(UUID_NOTE_TOP, -3)).toThrow(RangeError);
    expect(() => colorIndex(UUID_NOTE_TOP, 4.5)).toThrow(RangeError);
  });

  it("rejects NaN, Infinity, and -0 palette sizes", () => {
    // The guard `!Number.isInteger(paletteSize) || paletteSize < 1` catches
    // all three, but through different branches: NaN and Infinity fail the
    // isInteger half, while -0 is an integer and is only stopped by the
    // `< 1` half. Pinning each keeps a future guard rewrite from loosening
    // one branch and letting modulo-by-such-a-size return junk instead of
    // failing loudly.
    expect(() => colorIndex(UUID_NOTE_TOP, Number.NaN)).toThrow(RangeError);
    expect(() => colorIndex(UUID_NOTE_TOP, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => colorIndex(UUID_NOTE_TOP, -0)).toThrow(RangeError);
  });
});

describe("pure by construction (no hidden state)", () => {
  it("produces identical per-id values regardless of call order", () => {
    // Run each id through the functions in one order, then again in the
    // opposite order — a call-order-dependent module (e.g. a mutating
    // counter) would diverge on the second pass.
    for (const id of [...FIXTURE_IDS, ...SWEEP_IDS]) {
      const forward = [tilt(id), edgeOffset(id), colorIndex(id, 5)];
      const backward = [colorIndex(id, 5), edgeOffset(id), tilt(id)];
      expect(backward).toEqual([...forward].reverse());
      // And a pure pass change: tilt again right after color, unchanged.
      expect(tilt(id)).toBe(forward[0]);
    }
  });
});
