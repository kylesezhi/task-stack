/**
 * T32's sheet-motion PLANNER (TASKS.md T32, DESIGN.md §7) — the pure,
 * DOM-free half of the sheet slide: given the reduced-motion bit and the
 * desired slide axis, it answers "fade or fly, and how far". The DOM-touch
 * half (web/src/lib/sheet-motion.ts) reads tokens, matchMedia, and the
 * Svelte transitions; this module stays a plain function so the decision
 * itself is unit-testable without a DOM (the house note-style.ts pattern).
 *
 * Reduced motion (§7 "every animation becomes a simple fade") collapses the
 * plan to a zero-offset fade — the sheet appears by opacity alone, never by
 * translation.
 */

/** The slide axis in px. Omitted axes default to 0 (no motion on that axis). */
export interface SheetAxis {
  x?: number;
  y?: number;
}

/** What the transition layer should play. */
export interface SheetMotionPlan {
  kind: "fade" | "fly";
  x: number;
  y: number;
}

/**
 * Plans the sheet's enter/exit motion. `reduced` ⇒ a fade with no offset;
 * otherwise a fly along the given axis (omitted axes default to 0).
 */
export function planSheetMotion(reduced: boolean, axis: SheetAxis = {}): SheetMotionPlan {
  if (reduced) return { kind: "fade", x: 0, y: 0 };
  return { kind: "fly", x: axis.x ?? 0, y: axis.y ?? 0 };
}
