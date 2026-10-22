import { describe, expect, it } from "vitest";
import type { AppState, CompletedNote, Note, Stack } from "./index.js";

describe("shared type surface", () => {
  it("assembles a full AppState from typed fixtures", () => {
    const stack: Stack = {
      id: "stack-1",
      name: "Work",
      position: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    // position 1 = top of the stack, increasing downward
    const top: Note = {
      id: "note-1",
      stackId: stack.id,
      text: "call the bank",
      position: 1,
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const bottom: Note = {
      id: "note-2",
      stackId: stack.id,
      text: "buy stamps",
      position: 2,
      createdAt: "2026-01-01T09:05:00.000Z",
    };

    const done: CompletedNote = {
      id: "note-0",
      text: "water the plant",
      stackId: stack.id,
      stackName: stack.name,
      createdAt: "2026-01-01T08:00:00.000Z",
      completedAt: "2026-01-01T08:30:00.000Z",
    };

    const state: AppState = {
      activeStackId: stack.id,
      stacks: [stack],
      notes: [bottom, top],
      completed: [done],
    };

    expect(state.activeStackId).toBe(stack.id);
    expect(state.notes).toHaveLength(2);

    // notes ordering semantics: ascending position, 1 = top
    const ordered = [...state.notes].sort((a, b) => a.position - b.position);
    expect(ordered[0]).toEqual(top);
    expect(ordered[1]).toEqual(bottom);

    expect(done.stackName).toBe("Work");
    expect(done.completedAt >= done.createdAt).toBe(true);
  });
});
