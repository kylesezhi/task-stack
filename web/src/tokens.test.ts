/**
 * T24 token guard + palette pin (source: TASKS.md T24, DECISIONS.md §8/§11).
 *
 * Two jobs, both guarding the single-source-of-color decision:
 *
 * 1. COLORS-ONLY-FROM-TOKENS GUARD — every color a component STYLES with
 *    must come from tokens.css via var() (or color-mix over a token —
 *    DECISIONS.md §11 already licenses evergreen-only syntax). This walks
 *    web/src's .svelte/.css files and scans component stylesheets only:
 *    - .css files: the whole comment-stripped file;
 *    - .svelte files: each <style> block's contents plus the values of
 *      inline style="…" / style='…' attributes found in the markup.
 *    Anything outside those targets — template prose ("white paper"), small
 *    JS copy, comments — is deliberately NOT scanned, which is what makes
 *    the named-color rule below prose-safe. It fails on ANY hex literal,
 *    functional color notation, or curated named color outside tokens.css
 *    itself — where the composite shadow rgba values are allowed only
 *    because they're verbatim mockup data, not per-component mixing
 *    decisions. The T24 Done-when "tokens are the only color source in
 *    components" is this test, not an eyeball pass; it fails with file:line
 *    so the fix is mechanical.
 *
 *    Order of operations per scanned string: comment-strip (so prose in
 *    explanatory headers can't trip), THEN blank var(…) calls (critical —
 *    `var(--gold)` / `var(--gold-soft)` carry the word "gold" inside them
 *    and must NOT trip the named-color rule), THEN match. `transparent`,
 *    `currentColor`, `inherit`, and var() references are fine by design.
 *    The hex pattern is `#[0-9a-fA-F]{3,8}` + a word boundary after the
 *    last accepted hex char: Svelte's `{#each ...}` markup looks like
 *    `#eac` followed by `h` — a word char hard against the match means no
 *    boundary, so no false positive (sanity-tested below).
 *
 *    EXTENDED BANNED PATTERNS (curated accident-list, deliberate): the
 *    functional notations (rgb(a)/hsl(a)/oklch/lch/lab/hwb/color) plus a
 *    hand-picked set of high-frequency CSS named colors — NOT the full
 *    148-name list. Full coverage isn't the goal; catching the likely oops
 *    (reaching for "white"/"black"/"gray"/"gold" instead of a paper/ink
 *    token) is. Prose safety comes from the scan targets above, and
 *    multi-line inline style attribute VALUES (a value starting on one line
 *    and continuing past the newline) are outside this file-block scanner —
 *    accepted edge: our attributes are one-liners.
 *
 * 2. PALETTE PIN — tokens.css must define EXACTLY 8 `--note-*` tokens with
 *    exactly the approved mockup hexes in mockup order, plus anchor values
 *    (--desk, --accent, --accent-hover, --on-accent). Why pin: T25's
 *    `colorIndex(id, 8)` resolves `var(--note-{i})` — a silently drifted
 *    palette (a rename, a reorder, a hex tweak) would change the
 *    deterministic per-note colors that T23's pure functions swear are
 *    stable across reloads and devices. Too load-bearing to leave to
 *    review eyeballs; this is the file T25 reads the contract from.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/** Directory that contains this test (web/src). All reads resolve from it. */
const srcRoot = join(fileURLToPath(import.meta.url), "..");

/** Recursively collects web/src's .svelte/.css files with their srcRoot-
 * relative paths. `node_modules`, `dist`, and any `tests` directory are
 * never under src/ today, but the walk refuses a wander regardless. */
function collect(dir: string): Array<{ file: string; rel: string }> {
  const files: Array<{ file: string; rel: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "tests") {
      continue;
    }
    const full = join(dir, entry.name);
    const rel = join(dir === srcRoot ? "" : dir.slice(srcRoot.length + 1), entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(full));
    } else if (entry.name.endsWith(".svelte") || entry.name.endsWith(".css")) {
      files.push({ file: full, rel });
    }
  }
  return files;
}

/** The one file allowed to carry color literals (it IS the source) —
 * exactly `web/src/tokens.css`, BY RELATIVE PATH, so a future nested
 * tokens.css cannot inherit the exemption via basename coincidence. */
const EXEMPT = "tokens.css";

/**
 * Blanks comment ranges with SAME-LENGTH whitespace so match indices — and
 * therefore reported line numbers — still point at the real file's lines.
 * HTML comments go first (they may wrap code that itself contains `//`),
 * then line comments to end-of-line, then block comments.
 */
function stripComments(source: string): string {
  const blank = (match: string) => " ".repeat(match.length);
  return source
    .replaceAll(/<!--[\s\S]*?-->/g, blank)
    .replaceAll(/\/\/[^\n]*/g, blank)
    .replaceAll(/\/\*[\s\S]*?\*\//g, blank);
}

/**
 * Blanks var(…) calls with same-length whitespace — the token INDIRECTION
 * is the approved mechanism, and the token NAMES themselves (gold, soft,
 * deep, …) must not register as colors. Non-greedy to the first `)`: no
 * current token call nests var() inside var()'s fallback slot; if one ever
 * does, expand the matcher then.
 */
function blankVarCalls(source: string): string {
  return source.replaceAll(/var\([^)]*\)/g, (match) => " ".repeat(match.length));
}

/** The banned literal shapes. `#[0-9a-fA-F]{3,8}\b`: 3–8 hex digits with a
 * word boundary after them (see the header for the `{#each}` non-catch). */
const HEX = /#[0-9a-fA-F]{3,8}\b/;
/** Functional color notations. `color(` cannot collide with `color-mix(`
 * (next char is `-`, not `(`) or the `color:` property (no paren on that
 * position); the `\b` keeps it from matching inside another word, either. */
const FUNC = /\b(?:rgba?|hsla?|oklch|lch|lab|hwb|color)\(/;
/** Curated named colors (header: accident-list, not the full 148). The
 * word is required to STAND ALONE (`(?<![\w-])…(?![\w-])`): a CSS color
 * value is never hyphen-joined to its neighbors, while property NAMES can
 * carry color words — `white-space:` would otherwise trip as "white". */
const NAMED =
  /(?<![\w-])(?:white|black|silver|gray|grey|dimgray|dimgrey|darkgray|darkgrey|lightgray|lightgrey|red|green|blue|yellow|orange|purple|pink|brown|gold|ivory|beige|linen|wheat|tan|khaki)(?![\w-])/i;

/** The one banned-shape report on a comment-stripped, var-blanked line (or
 * null). Returns a trimmed preview for the failure message. */
function findOffenses(line: string): string | null {
  if (HEX.test(line) || FUNC.test(line) || NAMED.test(line)) {
    return line.trim().slice(0, 80);
  }
  return null;
}

/** A <style> block's inner-content range in the raw source: [start, end). */
function styleBlockRanges(source: string): Array<[number, number]> {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => {
    const from = match.index! + match[0].indexOf(">") + 1; // inner content start
    const to = match.index! + match[0].length - "</style>".length;
    return [from, to] as [number, number];
  });
}

/** Line number (0-based) of an absolute raw index, in `stripped` — offsets
 * are identical because stripping is same-length. */
function lineOfIndex(stripped: string, index: number): number {
  return index <= 0 ? 0 : stripped.slice(0, index).split("\n").length - 1;
}

/**
 * Scans ONE file's scan targets at its REAL line numbers. For .svelte,
 * style-block lines are probed whole (they are stylesheets); every other
 * line is probed ONLY for its inline style="…"/style='…' attribute values —
 * markup prose never reaches the rules. For .css, every line is a target.
 * Returns file-relative reports ("lineNo: preview").
 */
function scanTargets(raw: string, isSvelte: boolean): string[] {
  const stripped = blankVarCalls(stripComments(raw));
  const lines = stripped.split("\n");
  const ranges = isSvelte ? styleBlockRanges(raw) : [];
  const reports: string[] = [];
  for (const [index, line] of lines.entries()) {
    const probes: string[] = [];
    const inStyleBlock = ranges.some(
      ([from, to]) => index >= lineOfIndex(stripped, from) && index < lineOfIndex(stripped, to),
    );
    if (inStyleBlock || !isSvelte) {
      probes.push(line);
    } else {
      for (const match of line.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        probes.push(match[1] ?? match[2] ?? "");
      }
    }
    for (const probe of probes) {
      const offense = findOffenses(probe);
      if (offense !== null) reports.push(`${index + 1}: ${offense}`);
    }
  }
  return reports;
}

test("no color literals outside tokens.css (guard: colors only come from tokens)", () => {
  // Sanity on the walk itself: app.css + all eight .svelte files must be IN
  // the scan, otherwise the guard passes vacuously after a future rename.
  // The exact breakdown (update it when a component or view joins):
  // App shell (1) + views (5: FirstRun/Archive/List/Stacks/Stack) +
  // components (2: NoteCard T25, PeekingEdges T26) = 8.
  const files = collect(srcRoot);
  expect(files.filter((entry) => entry.rel === "app.css")).toHaveLength(1);
  expect(files.filter((entry) => entry.file.endsWith(".svelte"))).toHaveLength(8);
  expect(
    files.some((entry) => entry.rel === EXEMPT),
    "tokens.css must exist to be exempted",
  ).toBe(true);

  const offenders: string[] = [];
  for (const { file, rel } of files) {
    if (rel === EXEMPT) continue;
    for (const report of scanTargets(readFileSync(file, "utf8"), file.endsWith(".svelte"))) {
      offenders.push(`./${rel}:${report}`);
    }
  }
  expect(
    offenders,
    offenders.length > 0
      ? "color literals outside tokens.css (values must be var() references)"
      : undefined,
  ).toEqual([]);
});

test("guard pattern sanity: markup/prose near-misses pass, real literals trip", () => {
  // {#each} markup and "#1"-style prose must not count (boundary rule).
  expect(HEX.test("{#each stackNotes as note (note.id)}")).toBe(false);
  expect(HEX.test("see #1 and #12 and #ab for details")).toBe(false);
  // 2 hex digits is not a color; 9 hex digits has no boundary at {3,8}'s stop.
  expect(HEX.test("color: #ff")).toBe(false);
  expect(HEX.test("color: #ffffffffff")).toBe(false);
  // Real literals in every common shape fire.
  expect(HEX.test("color: #fff;")).toBe(true);
  expect(HEX.test("color: #555")).toBe(true);
  expect(HEX.test("border: 1px solid #e4e2dd")).toBe(true);
  expect(FUNC.test("background: rgba(0, 0, 0, 0.1)")).toBe(true);
  expect(FUNC.test("background: hsl(0 0% 50%)")).toBe(true);
  // Extended functional shapes: oklch trips; the evergreen compose does NOT
  // (color( can't match color-mix(: the next char is `-`, not `(`; and the
  // property spelling `color:` has no paren on that position at all).
  expect(FUNC.test("background: oklch(0.5 0.1 20)")).toBe(true);
  expect(FUNC.test("background: lch(50% 20 30)")).toBe(true);
  expect(FUNC.test("background: color-mix(in srgb, var(--paper) 90%, transparent)")).toBe(false);
  expect(FUNC.test("color: red")).toBe(false);
  // Named colors: the accident-list fires on bare usage…
  expect(NAMED.test("color: white")).toBe(true);
  expect(NAMED.test("background: gold")).toBe(true);
  // …survives var() indirection (token NAMES are not colors)…
  expect(NAMED.test(blankVarCalls("background: var(--gold)"))).toBe(false);
  expect(NAMED.test(blankVarCalls("background: var(--gold-soft)"))).toBe(false);
  expect(HEX.test(blankVarCalls("color: var(--ink-muted)"))).toBe(false);
  // …and allowed keywords stay allowed.
  expect(NAMED.test("color: transparent")).toBe(false);
  expect(NAMED.test("border-color: currentColor")).toBe(false);
  expect(NAMED.test("border-color: inherit")).toBe(false);
  // NAMED is standalone-word matching, hyphen-anchored: `white-space:` must
  // NOT read as the color "white"…
  expect(NAMED.test("white-space: nowrap")).toBe(false);
  expect(NAMED.test(".note-white")).toBe(false);
  // …while a bare value in prose still matches as a word — which is
  // precisely why the SCAN TARGETS exclude markup prose (it would only be
  // scanned at all if it were inside a style block, where it rightly
  // trips). Prose safety is asserted end-to-end by the scan-target test
  // below.
  expect(NAMED.test("white paper")).toBe(true);
});

test("scan-target sanity: style blocks + style attrs are targets, markup prose is not", () => {
  const markup =
    [
      "<p>plain prose mentions white paper and gold stars — no style here</p>",
      '<p style="color: #fff">a real inline style attribute</p>',
      "",
      "<style>",
      "  .x { color: #fff; }",
      "  .y { color: var(--ink-muted); width: var(--gold); }",
      "  /* commented #555 and the word gold are blanked first */",
      "</style>",
    ].join("\n") + "\n";
  const reports = scanTargets(markup, true);
  // Trip on BOTH real literals (the attribute on line 2, the block on line
  // 5) and on NOTHING else: not the prose (line 1), not the var() uses
  // (line 6, --gold included), not the commented shapes (line 7).
  expect(reports).toEqual(["2: color: #fff", "5: .x { color: #fff; }"]);
});

/** tokens.css once, comment-stripped: declarations parse cleanly, while the
 * header's provenance prose (rich in mockup hexes) never pollutes a match. */
const tokensContent = stripComments(readFileSync(join(srcRoot, "tokens.css"), "utf8"));

/** `--name: hex` extracted from tokens.css, or a loud failure (forced by
 * the expect inside). */
function tokenHex(name: string): string {
  const match = tokensContent.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\b`));
  expect(match, `tokens.css must declare --${name}`).not.toBeNull();
  return match![1] as string;
}

test("tokens.css defines exactly 8 note tokens, in mockup order, with the pinned hexes", () => {
  // The index IS the contract: T25 maps colorIndex(id, 8) → var(--note-{i}).
  // Numbered tokens 0–7, EXACTLY, each carrying exactly the approved hex.
  const approved: Record<number, string> = {
    0: "#fef39e", // canary
    1: "#fcf195", // deep canary
    2: "#fdeede", // peach
    3: "#fce8db", // warm peach
    4: "#e4efe7", // mint
    5: "#e0eee4", // deep mint
    6: "#f7e2de", // rose
    7: "#e9e4f0", // lavender
  };
  const declared = [...tokensContent.matchAll(/--note-([0-9]+)\s*:/g)].map((match) =>
    Number(match[1]),
  );
  expect(declared.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  for (const [index, hex] of Object.entries(approved)) {
    expect(tokenHex(`note-${index}`), `--note-${index} drift`).toBe(hex);
  }
});

test("tokens.css palette anchors are pinned", () => {
  expect(tokenHex("desk")).toBe("#fbf9f3");
  expect(tokenHex("accent")).toBe("#ae2a0c");
  expect(tokenHex("accent-hover")).toBe("#972409");
  expect(tokenHex("on-accent")).toBe("#ffffff");
});
