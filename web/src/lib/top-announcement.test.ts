import type { Note } from "@task-stack/shared";
import { describe, expect, it } from "vitest";
import { topNoteAnnouncement } from "./top-announcement";

/**
 * T33 announcement-copy tests: the register and the shapes (empty / one /
 * plural) are pinned here so the component wiring can't drift the words.
 * Fixture notes carry only what the copy reads (text), in the position-
 * sorted shape the function's contract requires.
 */

/** A minimal Note with just what the copy reads: text (+ position). */
function note(text: string, position = 1): Note {
  return {
    id: `note-${position}`,
    stackId: "stack-1",
    text,
    position,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("top-note announcement copy (T33)", () => {
  it("empty stack names the stack, no top note, no exclamation", () => {
    expect(topNoteAnnouncement("Errands", [])).toBe("Errands is empty.");
  });

  it("one note: text, stack name, singular count", () => {
    expect(topNoteAnnouncement("Errands", [note("Fix the leaky faucet")])).toBe(
      "Fix the leaky faucet — top of Errands, 1 note.",
    );
  });

  it("plural count from two notes up, still the TOP note's text", () => {
    const notes = [note("Order a ladder", 1), note("Fix the leaky faucet", 2)];
    expect(topNoteAnnouncement("Errands", notes)).toBe("Order a ladder — top of Errands, 2 notes.");
  });

  it("strips trailing sentence punctuation for speech only", () => {
    // "Buy milk." + the announcement's own period would read as a stutter;
    // the spoken copy normalizes, the STORED text is never touched.
    const stored = note("Buy milk.");
    expect(topNoteAnnouncement("Errands", [stored])).toBe("Buy milk — top of Errands, 1 note.");
    expect(stored.text).toBe("Buy milk.");
  });

  it("strips each sentence-punctuation flavor, including ellipsis and ?!", () => {
    for (const [text, expected] of [
      ["Call mom?", "Call mom — top of Errands, 1 note."],
      ["Pay rent!!", "Pay rent — top of Errands, 1 note."],
      ["Wait for it…", "Wait for it — top of Errands, 1 note."],
      ["Trailing space.  ", "Trailing space — top of Errands, 1 note."],
    ] as const) {
      expect(topNoteAnnouncement("Errands", [note(text)])).toBe(expected);
    }
  });

  it("strips trailing closing quotes and brackets for speech", () => {
    // One pass strips the whole trailing noise run (period inside a closing
    // quote); stripping is trailing-only, so an OPENING quote/bracket stays.
    expect(topNoteAnnouncement("Errands", [note("Buy milk.”")])).toBe(
      "Buy milk — top of Errands, 1 note.",
    );
    expect(topNoteAnnouncement("Errands", [note("Water the plants]")])).toBe(
      "Water the plants — top of Errands, 1 note.",
    );
  });

  it("strips trailing comma, semicolon, and colon for speech", () => {
    // A stored "Milk," + the announcement's own period would read as a
    // dangling pause; comma/semicolon/colon join the trailing-noise run.
    for (const [text, spoken] of [
      ["Milk,", "Milk"],
      ["Eggs;", "Eggs"],
      ["Note to self:", "Note to self"],
    ] as const) {
      expect(topNoteAnnouncement("Errands", [note(text)])).toBe(
        `${spoken} — top of Errands, 1 note.`,
      );
    }
  });

  it("falls back to a neutral phrase when stripping leaves nothing to speak", () => {
    // "!!!" strips to "" — the announcement must not start with a bare
    // " — top of …" em dash; the neutral phrase keeps the sentence whole.
    expect(topNoteAnnouncement("Errands", [note("!!!")])).toBe("A note — top of Errands, 1 note.");
    expect(topNoteAnnouncement("Errands", [note(" . ?!")])).toBe(
      "A note — top of Errands, 1 note.",
    );
  });
});
