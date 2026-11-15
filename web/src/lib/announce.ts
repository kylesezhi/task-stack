/**
 * The ONE global polite live region (T33 slice 1; sources: TASKS.md T33,
 * DESIGN.md §6 register). App.svelte renders the single visually-hidden
 * `role="status"` element bound to `announcement`; every other component
 * calls `announce()` and never renders its own region — one region means
 * one ordering of screen-reader chatter, not a chorus.
 */
import { writable } from "svelte/store";

/** The current announcement text, rendered by App's live region. */
export const announcement = writable("");

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Announce `message` politely. Identical messages WITHIN the 1s clear
 * window are deduped (an unchanged text node is not re-spoken — pushing two
 * identical notes back to back speaks only the first); it is the clear
 * after that beat which lets a LATER identical message re-announce. */
export function announce(message: string): void {
  announcement.set(message);
  if (clearTimer !== undefined) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    announcement.set("");
    clearTimer = undefined;
    // Long enough for a screen reader to have picked the change up
    // (polite regions queue on mutation), short enough to never linger.
  }, 1000);
}
