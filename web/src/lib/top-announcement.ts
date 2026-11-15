/**
 * Pure copy for the desk's top-note announcement (T33 slice 1; sources:
 * TASKS.md T33, DESIGN.md §6 register). App.svelte observes top-note
 * changes (keyed stack:topId) and speaks the result through the one
 * global polite live region. Pure + string-in/string-out so the register
 * is unit-pinned here and the component only wires it.
 */
import type { Note } from "@task-stack/shared";

/**
 * Strips TRAILING sentence punctuation, commas/semicolons/colons, closing
 * quotes/brackets, and the whitespace around them from a note text — for
 * SPOKEN copy only. A stored "Buy milk." would otherwise be spoken as
 * "Buy milk.." once the announcement appends its own period, and a
 * trailing quote or bracket would read the same dangling way; the stored
 * text itself is never altered (string replace, no mutation).
 */
const TRAILING_SPEECH_NOISE = /[\s.!?…,;:"'”’)\]}】」»›]+$/u;

function spoken(text: string): string {
  return text.replace(TRAILING_SPEECH_NOISE, "");
}

/**
 * The announcement for the state of `notes` in `stackName`. Contract:
 * `notes` is position-sorted (server truth — 1 = top), so index 0 is the
 * note on top. Empty: the quiet empty line; otherwise the top note's text,
 * the stack it sits on, and the count (singular "1 note", plural "notes").
 * No exclamation marks anywhere — the register is quietly playful (§6).
 */
export function topNoteAnnouncement(stackName: string, notes: readonly Note[]): string {
  if (notes.length === 0) {
    return `${stackName} is empty.`;
  }
  const top = notes.at(0); // .at() types undefined even past the empty check
  if (top === undefined) return `${stackName} is empty.`;
  const count = notes.length === 1 ? "1 note" : `${notes.length} notes`;
  // A note that IS only punctuation ("!!!") strips to nothing — a leading
  // em dash would be spoken; fall back to a neutral phrase instead.
  const stripped = spoken(top.text);
  const spokenText = stripped.length > 0 ? stripped : "A note";
  return `${spokenText} — top of ${stackName}, ${count}.`;
}
