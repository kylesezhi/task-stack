/**
 * T32's sheet-motion DOM layer (TASKS.md T32, DESIGN.md §7 "Open/close list
 * & drawers: paper sheets slide" / "Reduced motion: every animation becomes
 * a simple fade") — Svelte transition functions for the three paper sheets:
 * Each view's own `in:fade` fades the scrim in — intro-only, so an outro's
 * out() is a no-op and the overlay is never marked inert; the still-mounted
 * scrim keeps blocking desk input until the SHEET's outro finishes and the
 * block is removed, while the sheet subtree itself is inert during its
 * slide-out via `out:sheetOut` (`in:sheetIn` / fly + cubicOut, the
 * built-in transitions — DECISIONS.md §11 "built-in spring/tween"; no
 * animation libraries).
 *
 * Why the durations are read in JS here: Svelte's transition config is
 * computed in JS at call time — a `duration` cannot be a `var(--motion-*)`
 * (CSS custom properties cannot parameterize the JS-driven transition), so
 * this file reads the tokens off `document.documentElement`'s computed
 * style and MIRRORS them with documented fallbacks. Keep the three
 * fallbacks in sync with tokens.css (they exist for a pre-token paint
 * window and non-document contexts; the plan test above never touches a
 * DOM, so the pure planner stays testable).
 */
import { cubicOut } from "svelte/easing";
import { fade, fly } from "svelte/transition";
import type { TransitionConfig } from "svelte/transition";
import { planSheetMotion, type SheetAxis } from "./sheet-motion-plan";

/** Mirrors --motion-fade (tokens.css). */
const FALLBACK_FADE_MS = 150;
/** Mirrors --motion-sheet (the slide IN). */
const FALLBACK_SHEET_MS = 240;
/** Mirrors --motion-sheet-out (the slide OUT). */
const FALLBACK_SHEET_OUT_MS = 180;

/**
 * Reads a duration token off :root's computed style, e.g. "240ms" → 240.
 * Falls back when the document isn't available (SSR-ish contexts) or the
 * token is missing/unparsable.
 */
function tokenMs(token: string, fallbackMs: number): number {
  const root = typeof document === "undefined" ? null : document.documentElement;
  const raw = root === null ? "" : getComputedStyle(root).getPropertyValue(token).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/** §7 reduced-motion detection (the NoteCard/PopCeremony pattern, in JS:
 * the transition choice happens at call time, not in a media query). */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

/** A shared axis planning step so sheetIn/sheetOut differ only by clock. */
function planOf(axis: SheetAxis) {
  return planSheetMotion(prefersReducedMotion(), axis);
}

/** The sheet's slide-in: a fly along the given axis (e.g. `{ y: 20 }` for
 * the list/archive sheets, `{ x: -48 }` for the drawer); a plain fade when
 * reduced motion is on (--motion-fade). */
export function sheetIn(node: Element, axis: SheetAxis = {}): TransitionConfig {
  const plan = planOf(axis);
  if (plan.kind === "fade") {
    return fade(node, { duration: tokenMs("--motion-fade", FALLBACK_FADE_MS) });
  }
  return fly(node, {
    x: plan.x,
    y: plan.y,
    duration: tokenMs("--motion-sheet", FALLBACK_SHEET_MS),
    easing: cubicOut,
  });
}

/** The sheet's slide-out: the same axis, the shorter out clock
 * (--motion-sheet-out — closing is an exit, not an arrival). */
export function sheetOut(node: Element, axis: SheetAxis = {}): TransitionConfig {
  const plan = planOf(axis);
  if (plan.kind === "fade") {
    return fade(node, { duration: tokenMs("--motion-fade", FALLBACK_FADE_MS) });
  }
  return fly(node, {
    x: plan.x,
    y: plan.y,
    duration: tokenMs("--motion-sheet-out", FALLBACK_SHEET_OUT_MS),
    easing: cubicOut,
  });
}
