import type { Note } from "@task-stack/shared";

/**
 * T29/T30 departure detection (sources: TASKS.md T29/T30, DESIGN.md
 * §5.2/§7, DECISIONS.md §4/§7) — decides whether a fresh snapshot means
 * "the top note of this stack just LEFT", and WHICH ceremony the desk
 * owes it: a departure that shows up in completed[] is a POP (T29's full
 * fire ceremony — lift → crumple → burn → embers over the revealed note),
 * a departure that leaves no archive row is a TOSS (T30's quiet crumple
 * and drop out of frame — DESIGN.md §7: "No fire for tossed notes", the
 * DECISIONS.md §7 quip is "toss gets a brief quiet crumple") — and only
 * those, never on a reload, a switch, a push, a reorder, an edit, or the
 * duplicate WS rebroadcast.
 *
 * Sibling of push-land.ts, same house pattern: the rule is temporal —
 * "the top I saw one observation ago is GONE, and where did it go?" — so
 * it cannot be a pure derivation of one snapshot; completed[] is the
 * discriminator between the two departures. Exactly two server writes
 * remove the top note of a stack (server/src/notes.ts): a POP (complete
 * keeps the note's uuid on the completed_notes row — the server models it
 * as a row MOVE) and a TOSS (the delete destroys it, archiving nothing —
 * DECISIONS.md §4: tossed notes never reach the archive). Every detector
 * case:
 * - push: the previous top is still in the pile (just buried) — none;
 * - reorder/edit: the id set is unchanged / the top stays — none;
 * - a mid-list completion or mid-list toss (list view, or edit rows):
 *   the TOP never moves, so the desk's visible card is identical — none;
 * - the WS rebroadcast that follows every mutation's HTTP-response
 *   snapshot re-observes the SAME pile — a duplicate must stay "none"
 *   (pop AND toss alike: the departure was already answered once);
 * - a pop or toss discovered after a reconnect gap (the pile advanced
 *   while nobody was watching) still fires ONCE, for the net effect —
 *   same philosophy as push-land's "push after a gap";
 * - a pile observed twice with no departure in between (including an
 *   emptied pile re-observed) — none.
 *
 * The returned note object comes from the tracker's OWN previous
 * observation — the ghost must show the note as it last sat on the desk
 * (its text could be gone from the snapshot entirely by the time the
 * ceremony starts). Snapshots are immutable fresh arrays/objects per
 * broadcast, so holding the reference is safe.
 */

/** What one observation means for the desk. */
export type DepartureObservation =
  /** The previous top note was completed: run the fire ceremony for it.
   * `revealedId` is the NEW top note (the one the ceremony reveals), or
   * null when the pop emptied the stack. */
  | { kind: "pop"; note: Note; revealedId: string | null }
  /** The previous top note was tossed: run the quiet crumple-and-drop.
   * `revealedId` is still returned (the new top the toss uncovers; null
   * when the toss emptied the stack) so callers CAN react, but StackView
   * deliberately does not spend it — no reveal bounce for a toss (the
   * toss is the quiet delete; only a pop springs the note beneath). */
  | { kind: "toss"; note: Note; revealedId: string | null }
  /** The observation baseline was (re)established — first-ever observation
   * or a stack switch. Any ceremony from another stack's pile is stale:
   * the caller clears it. */
  | { kind: "reset" }
  /** Nothing ceremony-worthy happened. */
  | { kind: "none" };

export class DepartureTracker {
  /** The previously observed (stackId, pile) pair — null until the first
   * observation. `pile` is stored by reference; snapshots hand over fresh
   * arrays each time, so nothing else can mutate it under us. */
  private previous: { stackId: string; pile: readonly Note[] } | null = null;

  /**
   * Observes successive piles of (usually the active) stack.
   *
   * @param stackId        The pile's stack — observations of differing ids
   *                       never interact (a switch is not a departure).
   * @param pileTopFirst   The stack's notes, position-ascending, index 0 =
   *                       the top card (StackView's `stackNotes` derived is
   *                       exactly this).
   * @param completedIds   Ids of every completed note in the same snapshot.
   *                       Presence is proof of a pop: an id departs `notes`
   *                       exactly once and `completed_notes` never held it
   *                       before (server invariant), so a departed top id
   *                       found here was completed; its absence (with the
   *                       same invariant) is proof of a toss.
   */
  observe(
    stackId: string,
    pileTopFirst: readonly Note[],
    completedIds: ReadonlySet<string>,
  ): DepartureObservation {
    // Record FIRST, answer from the recorded comparison — two consecutive
    // calls always see each other, whatever they return (the duplicate WS
    // rebroadcast destructor case depends on it).
    const previous = this.previous;
    this.previous = { stackId, pile: pileTopFirst };

    if (previous === null || previous.stackId !== stackId) {
      return { kind: "reset" };
    }
    const departed = previous.pile[0];
    // A pile that was already empty cannot have its top depart…
    if (departed === undefined) return { kind: "none" };
    // …and a top that is still in the pile was pushed over, reordered, or
    // edited — every still-present case is "none" in one check.
    if (pileTopFirst.some((note) => note.id === departed.id)) return { kind: "none" };
    // The split: archived = completed (the full fire, T29); departed but
    // NOT archived = tossed (the quiet crumple-and-drop, T30 — no fire
    // for quitters, DECISIONS.md §7). Both carry the note + the new top.
    if (completedIds.has(departed.id)) {
      return { kind: "pop", note: departed, revealedId: pileTopFirst[0]?.id ?? null };
    }
    return { kind: "toss", note: departed, revealedId: pileTopFirst[0]?.id ?? null };
  }
}
