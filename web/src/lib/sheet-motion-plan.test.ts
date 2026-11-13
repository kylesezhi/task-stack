/**
 * T32 unit tests for the sheet-motion planner (TASKS.md T32, DESIGN.md §7):
 * reduced motion collapses to a zero-offset fade; normal motion is a fly
 * along the given axis; omitted axes default to 0; both axes survive when
 * given. Pure function, node environment — no DOM here (that lives in
 * sheet-motion.ts).
 */
import { describe, expect, test } from "vitest";
import { planSheetMotion } from "./sheet-motion-plan";

describe("planSheetMotion", () => {
  test("reduced motion returns a fade with zero offsets", () => {
    expect(planSheetMotion(true, { x: -48, y: 20 })).toEqual({ kind: "fade", x: 0, y: 0 });
  });

  test("reduced motion with no axis still returns a fade", () => {
    expect(planSheetMotion(true)).toEqual({ kind: "fade", x: 0, y: 0 });
  });

  test("normal motion returns a fly with the given x/y", () => {
    expect(planSheetMotion(false, { x: -48 })).toEqual({ kind: "fly", x: -48, y: 0 });
    expect(planSheetMotion(false, { y: 12 })).toEqual({ kind: "fly", x: 0, y: 12 });
  });

  test("omitted axes default to 0 (no axis at all)", () => {
    expect(planSheetMotion(false)).toEqual({ kind: "fly", x: 0, y: 0 });
    expect(planSheetMotion(false, {})).toEqual({ kind: "fly", x: 0, y: 0 });
  });

  test("both axes are preserved together", () => {
    expect(planSheetMotion(false, { x: -32, y: 12 })).toEqual({ kind: "fly", x: -32, y: 12 });
  });
});
