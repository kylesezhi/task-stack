/**
 * Unit tests for the pure drop math (T19; sources: TASKS.md T19, DESIGN.md
 * §5.3). reorderNoteIds is framework-free and DOM-free, so these run in Node
 * (vitest.config.ts) like view-state.test.ts.
 */
import { describe, expect, it } from "vitest";
import { reorderNoteIds } from "./reorder";

describe("reorderNoteIds", () => {
  it("is a no-op when dragged onto itself — but returns a NEW array", () => {
    const ids = ["a", "b", "c"];
    const result = reorderNoteIds(ids, "b", "b");
    expect(result).toEqual(ids); // same order
    expect(result).not.toBe(ids); // fresh array; input untouched
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("last → first (bottom row dropped on top row) moves to the top", () => {
    expect(reorderNoteIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("first → last (top row dropped on bottom row) moves to the bottom", () => {
    expect(reorderNoteIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("moves a middle row to the top and to the bottom", () => {
    expect(reorderNoteIds(["a", "b", "c", "d"], "b", "a")).toEqual(["b", "a", "c", "d"]);
    expect(reorderNoteIds(["a", "b", "c", "d"], "b", "d")).toEqual(["a", "c", "d", "b"]);
  });

  it("swaps adjacent rows in both directions", () => {
    expect(reorderNoteIds(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(reorderNoteIds(["a", "b", "c"], "b", "a")).toEqual(["b", "a", "c"]);
    expect(reorderNoteIds(["a", "b", "c"], "b", "c")).toEqual(["a", "c", "b"]);
    expect(reorderNoteIds(["a", "b", "c"], "c", "b")).toEqual(["a", "c", "b"]);
  });

  it("preserves every id as a set for any move (sanity probe)", () => {
    for (const dragged of ["a", "b", "c", "d"]) {
      for (const target of ["a", "b", "c", "d"]) {
        expect([...reorderNoteIds(["a", "b", "c", "d"], dragged, target)].sort()).toEqual([
          "a",
          "b",
          "c",
          "d",
        ]);
      }
    }
  });

  it("keeps rows outside the moved range in their original relative order", () => {
    // Dragging d (last) to the top cycles a-d only around d's move; b and c
    // keep their relative order. Same for a (first) to the bottom.
    expect(reorderNoteIds(["a", "b", "c", "d", "e"], "d", "a")).toEqual(["d", "a", "b", "c", "e"]);
    expect(reorderNoteIds(["a", "b", "c", "d", "e"], "a", "e")).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("handles single-element and empty lists defensively", () => {
    expect(reorderNoteIds(["a"], "a", "a")).toEqual(["a"]);
    expect(reorderNoteIds([], "a", "a")).toEqual([]);
  });

  it("is a defensive no-op when either id is absent", () => {
    expect(reorderNoteIds(["a", "b", "c"], "x", "a")).toEqual(["a", "b", "c"]);
    expect(reorderNoteIds(["a", "b", "c"], "a", "x")).toEqual(["a", "b", "c"]);
    expect(reorderNoteIds(["a", "b", "c"], "x", "x")).toEqual(["a", "b", "c"]);
  });

  it("never mutates the input array, even on a real move", () => {
    const ids = ["a", "b", "c"];
    const frozen = Object.freeze([...ids]) as readonly string[];
    expect(reorderNoteIds(frozen, "a", "c")).toEqual(["b", "c", "a"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
