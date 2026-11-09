import type { Note } from "@task-stack/shared";

/**
 * T29 pop-ceremony detection (sources: TASKS.md T29, DESIGN.md §5.2/§7,
 * DECISIONS.md §3/§4/§7) — decides whether a fresh snapshot means "the top
 * note of this stack was just COMPLETED" so the desk can play the one big
 * moment (the lift → crumple → burn → embers ceremony over the revealed
 * note) — and only that, never on a reload, a switch, a push, a reorder, a
 * toss, or the duplicate WS rebroadcast.
 *
 * Sibling of push-land.ts, same house pattern: the rule is temporal — "the
 * top I saw one observation ago is GONE, and it went to the ARCHIVE" — so it
 * cannot be a pure derivation of one snapshot. Exactly one server write
 * removes the top note of a stack AND leaves its id in completed[]: a POP
 * (complete keeps the note's uuid on the completed_notes row — the server
 * models it as a row MOVE, server/src/notes.ts). Every destructor case:
 * - push: the previous top is still in the pile (just buried) — none;
 * - reorder/edit: the id set is unchanged / the top stays — none;
 * - toss: the top departs but completed[] does NOT gain it (DECISIONS.md §4:
 *   tossed notes never reach the archive) — none, and deliberately NO
 *   ceremony here: T30 owns the toss's quiet crumple, and it hooks in by
 *   distinguishing exactly this branch;
 * - the WS rebroadcast that follows every mutation's HTTP-response snapshot
 *   re-observes the SAME pile — a duplicate must stay "none";
 * - a pop observed after a reconnect gap (the pile advanced while nobody was
 *   watching) still fires ONCE, for the net effect — same philosophy as
 *   push-land's "push after a gap".
 *
 * The returned note object comes from the tracker's OWN previous observation
 * — the ghost must show the note as it last was on the desk (its text could
 * be gone from the snapshot entirely by the time the ceremony starts).
 * Snapshots are immutable fresh arrays/objects per broadcast, so holding the
 * reference is safe.
 */

/** What one observation means for the desk. */
export type PopObservation =
  /** The previous top note was completed: run the ceremony for it.
   * `revealedId` is the NEW top note (the one the ceremony reveals), or null
   * when the pop emptied the stack. */
  | { kind: "pop"; note: Note; revealedId: string | null }
  /** The observation baseline was (re)established — first-ever observation
   * or a stack switch. Any ceremony from another stack's pile is stale:
   * the caller clears it. */
  | { kind: "reset" }
  /** Nothing ceremony-worthy happened. */
  | { kind: "none" };

export class PopCeremonyTracker {
  /** The previously observed (stackId, pile) pair — null until the first
   * observation. `pile` is stored by reference; snapshots hand over fresh
   * arrays each time, so nothing else can mutate it under us. */
  private previous: { stackId: string; pile: readonly Note[] } | null = null;

  /**
   * Observes successive piles of (usually the active) stack.
   *
   * @param stackId        The pile's stack — observations of differing ids
   *                       never interact (a switch is not a pop).
   * @param pileTopFirst   The stack's notes, position-ascending, index 0 =
   *                       the top card (StackView's `stackNotes` derived is
   *                       exactly this).
   * @param completedIds   Ids of every completed note in the same snapshot.
   *                       Presence is proof of a pop: an id departs `notes`
   *                       exactly once and `completed_notes` never held it
   *                       before (server invariant), so a departed top id
   *                       found here was completed, not tossed.
   */
  observe(
    stackId: string,
    pileTopFirst: readonly Note[],
    completedIds: ReadonlySet<string>,
  ): PopObservation {
    // Record FIRST, answer from the recorded comparison — two consecutive
    // calls always see each other, whatever they return (the duplicate WS
    // rebroadcast destructor case depends on it).
    const previous = this.previous;
    this.previous = { stackId, pile: pileTopFirst };

    if (previous === null || previous.stackId !== stackId) {
      return { kind: "reset" };
    }
    const departed = previous.pile[0];
    // A pile that was already empty cannot have its top popped…
    if (departed === undefined) return { kind: "none" };
    // …and a top that is still in the pile was pushed over, reordered, or
    // edited — every still-present case is "none" in one check.
    if (pileTopFirst.some((note) => note.id === departed.id)) return { kind: "none" };
    // Departed but not archived = tossed (T30's hook; no fire for quitters).
    if (!completedIds.has(departed.id)) return { kind: "none" };
    return { kind: "pop", note: departed, revealedId: pileTopFirst[0]?.id ?? null };
  }
}
