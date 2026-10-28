import { describe, expect, it } from "vitest";
import { PushLandingTracker } from "./push-land";

/**
 * T27 landing-detection tests (sources: TASKS.md T27, DESIGN.md §7,
 * DECISIONS.md §3). The contract is the destructor analysis in the
 * tracker's header: only a PUSH can put a previously-unseen id at
 * position 1 of the SAME stack, so every other mutation — reveal,
 * reorder, edit, the duplicate WS rebroadcast, an emptied pile, a stack
 * switch — must observe its way back to null. Piles below are realistic
 * fixture id sequences (top first) because the rule reads the ARRANGEMENT,
 * never the note contents; a fresh tracker per test keeps the one stateful
 * instance a test-under-test rather than a shared channel.
 */

/** Viewer-ish uuid fixture ids, reused across tests the way snapshots repeat. */
const A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12";
const C = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13";
const D = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14";
const DESK = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666677-8888-9999-0000-111111112222";

describe("PushLandingTracker (T27)", () => {
  it("first observation of a stack is null — mount/reload is not a push", () => {
    const tracker = new PushLandingTracker();
    expect(tracker.observe(DESK, [B, A])).toBeNull();
  });

  it("a push: unseen id at the top of the same stack returns that id", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    expect(tracker.observe(DESK, [C, B, A])).toBe(C);
  });

  it("a push onto an empty pile (empty → 1) lands too", () => {
    const tracker = new PushLandingTracker();
    // The prior observation is the same stack, freshly emptied or new.
    expect(tracker.observe(DESK, [])).toBeNull();
    expect(tracker.observe(DESK, [A])).toBe(A);
  });

  it("a push after a gap (reconnect catch-up with an unseen top) lands", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    // The pile advanced while nobody was watching: the next observation
    // ALREADY contains an unreachable-history top — still a push.
    expect(tracker.observe(DESK, [C, D, B, A])).toBe(C);
  });

  it("a stack switch is never a push, even when its top is unseen", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    expect(tracker.observe(OTHER, [C])).toBeNull();
    // ...and the switch re-arms: the NEXT push on the other desk lands.
    expect(tracker.observe(OTHER, [D, C])).toBe(D);
  });

  it("reveal after done/toss — the new top was already buried — is null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    expect(tracker.observe(DESK, [A])).toBeNull();
  });

  it("a reorder that hands the top to an existing note is null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A, C]);
    expect(tracker.observe(DESK, [A, B, C])).toBeNull();
  });

  it("a mid-list toss that leaves the top unchanged is null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A, C]);
    expect(tracker.observe(DESK, [B, A])).toBeNull();
  });

  it("an edit (same pile, same order) is null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    expect(tracker.observe(DESK, [B, A])).toBeNull();
  });

  it("the duplicate WS rebroadcast of one snapshot re-observes to null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    // Every mutation flings the snapshot twice (HTTP response + WS
    // broadcast); the second copy must not re-land anything...
    expect(tracker.observe(DESK, [C, B, A])).toBe(C);
    expect(tracker.observe(DESK, [C, B, A])).toBeNull();
  });

  it("an emptied pile (everything done/tossed) is null", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [A]);
    expect(tracker.observe(DESK, [])).toBeNull();
  });

  it("observations keyed by DIFFERENT stacks never compare piles", () => {
    const tracker = new PushLandingTracker();
    tracker.observe(DESK, [B, A]);
    // The other desk's top coincidentally never appeared on the first pile;
    // a naive id-set diff across stacks would call this a landing.
    expect(tracker.observe(OTHER, [A])).toBeNull();
  });
});
