/**
 * T27 push-landing detection (sources: TASKS.md T27, DESIGN.md §7,
 * DECISIONS.md §3/§7/§11) — decides whether a fresh snapshot means "a note
 * just landed on this stack" or merely means anything else, so the desk's
 * spring fires on pushes and ONLY on pushes.
 *
 * Why a stateful tracker in lib/ (house pattern, note-style.ts /
 * edge-style.ts): the rule is temporal — "the top of THIS stack was absent
 * one observation ago" — so it cannot be a pure derivation of one snapshot.
 * Exactly one server write puts a previously-unseen id at position 1: a
 * PUSH. Everything else is provably not a landing:
 * - reorder only permutes the id set (server validates set equality);
 * - edit preserves the id; done/toss only REMOVE ids;
 * - the WS rebroadcast that follows every mutation's HTTP-response
 *   snapshot re-applies the SAME state — a duplicate observation of the
 *   same pile must stay a null.
 * The ONLY trap is identity: the observation is per-stack. Switching
 * stacks is not a push (the new pile's top was always there), so the first
 * observation of a DIFFERENT stack id also clears to null — that is why
 * the tracker keys its memory by stack id, not just by pile.
 *
 * DECISIONS.md §3 (the deterministic rest state) is the downstream
 * contract: a false positive here replays motion onto an already-settled
 * pile, so every destructor case below is a unit test, and the return is
 * the note id (not a boolean) so the caller can key the animation to the
 * landing card.
 */

/**
 * Observes successive piles of (usually the active) stack and returns the
 * id of the note that JUST landed on it, or null for "no push happened".
 *
 * @param stackId          The pile's stack — observations of differing ids
 *                         never interact (a switch is not a push).
 * @param noteIdsTopFirst  The stack's notes, position-ascending, index 0 =
 *                         the top card (StackView's `stackNotes` derived is
 *                         exactly this).
 * @returns `noteIdsTopFirst[0]` when a NEW id reached the top of the same
 *          stack as the previous observation; null otherwise (first-ever
 *          observation, stack switch, reveal after done/toss, reorder,
 *          edit, duplicate re-observation, empty pile).
 */
export class PushLandingTracker {
  /** The previously observed (stackId, pile) pair — null until the first
   * observation. `pile` is stored by reference; snapshots hand over fresh
   * arrays each time, so nothing else can mutate it under us. */
  private previous: { stackId: string; pile: readonly string[] } | null = null;

  observe(stackId: string, noteIdsTopFirst: readonly string[]): string | null {
    // Record FIRST, return from the recorded comparison — two consecutive
    // calls always see each other, whatever they return.
    const previous = this.previous;
    this.previous = { stackId, pile: noteIdsTopFirst };

    const top = noteIdsTopFirst[0];
    // An emptied pile has no top, and a first observation (or one after a
    // stack switch) has no comparable past — both are "no push".
    if (top === undefined || previous === null || previous.stackId !== stackId) {
      return null;
    }
    // The push rule: the top is a brand-new id. Present-in-previous covers
    // every destructor case (reveal/reorder/edit/duplicate) in one check.
    return previous.pile.includes(top) ? null : top;
  }
}
