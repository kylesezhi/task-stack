/**
 * Deterministic per-note visual randomness (DECISIONS.md §3 — "stable
 * pseudo-random rotation/offset derived deterministically from the note's id —
 * stable across reloads and devices, zero storage"; §8 — note colors "assigned
 * deterministically per note from id hash"; DESIGN.md §2 — top-note tilt
 * "±2–6°", buried edges "each offset 6–10px"). Per PLAN.md, this is the
 * shared layer that `web` stack components (T25/T26) consume so every device
 * renders the same stack for the same note ids.
 *
 * Everything here is a pure function of the inputs: no `Math.random`, no
 * `Date.now`, no `crypto`, no locale or environment input. The values are hash
 * picks — impossible to distinguish from coin flips, but identical everywhere,
 * forever, with nothing stored. Sign and magnitude are read from disjoint
 * final bit positions (sign from bit 31 of the mixed hash, magnitude
 * fraction from bits 0–15), so no final bit directly serves both; the
 * xor-shift mix means the *inputs* to those positions do overlap, but the
 * empirical distributions are balanced across signs (20k sweep ids: ~50/50
 * split, mean |tilt| ≈ 4.00 for each) — e.g., a right-lean isn't
 * systematically more upright than a left-lean.
 *
 * The hash is hand-rolled 32-bit FNV-1a plus a final xor-shift mix
 * (`h ^= h >>> 16` after the FNV loop). `Math.imul` + `>>> 0` keeps it in
 * uint32 arithmetic — endianness-free, identical in Node and browsers. The
 * finalizer is part of the contract, not an optional flourish: values are
 * not comparable with a textbook FNV-1a implementation, and without the mix
 * the low-bit picks below collapse onto a single bucket (see `hashStream`).
 * Each purpose restarts the byte stream from its own derived seed, giving
 * three decorrelated streams for the same note id; the color palette itself
 * is defined later (T24 tokens), hence the `paletteSize` parameter.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** XORs one byte in and multiplies, staying inside unsigned 32-bit range. */
function mix(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

/**
 * Continues an FNV-1a stream from `start` over `input`. Hashing UTF-16 code
 * units as a low byte then a high byte makes the stream identical across
 * engines regardless of how strings are stored internally. Used both to
 * derive the per-purpose seeds (from a label) and to hash ids into them.
 *
 * The stream ends with one xor-shift avalanche (`h ^= h >>> 16`). Plain
 * FNV-1a is weak in its low bits: the multiply only diffuses bits upward
 * and the per-byte XOR only carries bits 0–7, so the hash's low output
 * bits depend solely on the low bits of the input bytes. Ids whose varying
 * parts cancel in those low bits — the test sweep encodes the same index
 * hex in two different uuid segments — keep those low bits constant:
 * measured, all 160 sweep ids land in a single `% 4` bucket without the mix
 * (power-of-two moduli collapse; `% 5` and the 16-bit magnitude picks stay
 * spread). The multiply pushes low-bit influence upward, and the xor-shift
 * folds those high bits back down into the picks, so the chosen bucket
 * spreads across the palette again.
 */
function hashStream(start: number, input: string): number {
  let hash = start >>> 0;
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    hash = mix(hash, unit & 0xff);
    hash = mix(hash, (unit >>> 8) & 0xff);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// Purpose seeds are themselves FNV-1a hashes of the purpose labels, so each
// public function runs an independent stream: tilt sign/lean and edge peek
// side and colors never feed off the same bits for the same note.
const TILT_SEED = hashStream(FNV_OFFSET_BASIS, "task-stack:tilt");
const EDGE_SEED = hashStream(FNV_OFFSET_BASIS, "task-stack:edge");
const COLOR_SEED = hashStream(FNV_OFFSET_BASIS, "task-stack:color");

/** Fraction in [0, 1) from the hash's low 16 bits (never exactly 1, so the
 * derived magnitudes never exceed their ceiling). Deliberately disjoint from
 * the sign bit (bit 31) so magnitude and sign are decorrelated. */
function unit(hash: number): number {
  return (hash & 0xffff) / 0x10000;
}

/** +1 or -1 from the hash's top bit — the lean/peek direction. */
function sign(hash: number): number {
  return (hash >>> 31) & 1 ? 1 : -1;
}

/** Inclusive lower magnitude bound for `tilt`, in degrees (DESIGN.md §2). */
const TILT_MIN_DEGREES = 2;
/** Spread above the minimum: magnitudes run [2, 6) degrees. */
const TILT_SPREAD_DEGREES = 4;

/** Inclusive lower magnitude bound for `edgeOffset`, in px (DESIGN.md §2). */
const EDGE_MIN_PX = 6;
/** Spread above the minimum: magnitudes run [6, 10) px. */
const EDGE_SPREAD_PX = 4;

/**
 * Signed rotation for the note's top card, in degrees. Magnitude is always in
 * [2, 6): never 0 (a perfectly straight note looks gridded) and never ≥ 6
 * (stay calm). Negative leans left, positive leans right; the lean direction
 * and magnitude are both derived from the note's `id` and stable forever.
 */
export function tilt(id: string): number {
  const hash = hashStream(TILT_SEED, id);
  return sign(hash) * (TILT_MIN_DEGREES + TILT_SPREAD_DEGREES * unit(hash));
}

/**
 * Signed horizontal offset for one of the note's buried edges, in px.
 * Magnitude is always in [6, 10). Negative means the edge peeks left of the
 * stack's center line, positive means right. The side is hash-derived rather
 * than strictly alternating, deliberately: strict parity would flip every
 * buried edge whenever a note is pushed or popped, so each note instead keeps
 * its own placement forever (DECISIONS.md §3) and populated stacks end up
 * with edges on both sides.
 */
export function edgeOffset(id: string): number {
  const hash = hashStream(EDGE_SEED, id);
  return sign(hash) * (EDGE_MIN_PX + EDGE_SPREAD_PX * unit(hash));
}

/**
 * Zero-based index into the note-color palette (the palette itself ships with
 * T24 design tokens, so only its size is known here). Returns an integer in
 * [0, paletteSize); deterministic per `id`, so a note keeps its color across
 * reloads and devices (DECISIONS.md §8). Throws `RangeError` unless
 * `paletteSize` is an integer ≥ 1 — a caller passing an empty or fractional
 * palette has a wiring bug, and modulo-by-zero would silently corrupt it.
 */
export function colorIndex(id: string, paletteSize: number): number {
  if (!Number.isInteger(paletteSize) || paletteSize < 1) {
    throw new RangeError(`paletteSize must be an integer >= 1, got ${paletteSize}`);
  }
  return hashStream(COLOR_SEED, id) % paletteSize;
}
