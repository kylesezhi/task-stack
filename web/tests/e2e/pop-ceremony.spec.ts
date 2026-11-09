/**
 * Pop ceremony e2e (T29; sources: TASKS.md T29 Done-when, DESIGN.md §5.2/§7,
 * DECISIONS.md §7). Mechanically pins what the done-when's visual review
 * can't carry in CI:
 *
 * - the ghost mounts on Done wearing the FULL ceremony (animation name
 *   contains "pop-ceremony" — containment, not equality: Svelte appends a
 *   scope hash — and never the "-fade" fallback in full motion), with live
 *   ember particles and the crumple's SVG displacement filter arriving on
 *   cue (a rAF-polled predicate catches the 27%–80% filter window);
 * - the burn is a MASK (the ghost's paper layer computes to a
 *   radial-gradient mask-image — DECISIONS.md §7's "burn via mask");
 * - exactly ONE .note-text exists while the ghost lives (the ghost's text
 *   is deliberately NOT the durable locator — the revealed card beneath is
 *   the one true .note-text);
 * - the action row rests during the ceremony (the T29 double-pop guard:
 *   Done/Edit/Toss disabled while the ghost burns, re-enabled when it
 *   clears) while quick-add stays live;
 * - the revealed card settles with its own pop-reveal (never push-land —
 *   the push-motion.spec Phase 4 boundary), then every flag self-clears;
 * - reduced motion becomes the simple fade (TASKS.md T29's done-when
 *   clause), pinned the same way push-motion Phase 5 pins T27's: an
 *   in-page poll armed BEFORE the click catches the razor-thin 150ms
 *   window — fade name, no transform, no mask, zero embers.
 *
 * ONE sequential test, deliberately (suite rule: this run's ONE DB, files
 * alphabetical, workers 1). Self-sufficient: creates its own "Ceremony
 * desk" stack via POST /api/stacks (which makes it ACTIVE, T10) and pushes
 * its notes via the API; sorts between list-view.spec.ts and
 * push-motion.spec.ts, whose self-sufficiency makes the leftover stack
 * (one pending note, some completed rows) inert. Probes are in-page
 * evaluates (no expect inside); assertions back in Node.
 */
import { expect, test } from "@playwright/test";

test("the pop ceremony burns the top note and reveals the next, gently", async ({
  page,
  request,
}) => {
  // -- Phase 1: setup via API — a two-note pile on a fresh active stack ----
  const created = await request.post("/api/stacks", { data: { name: "Ceremony desk" } });
  expect(created.ok()).toBe(true);
  const state = (await created.json()) as { activeStackId: string };
  await request.post(`/api/stacks/${state.activeStackId}/notes`, {
    data: { text: "Beneath the flame" },
  });
  await request.post(`/api/stacks/${state.activeStackId}/notes`, {
    data: { text: "Into the fire" },
  });
  await page.goto("/");
  await expect(page.locator(".note-text")).toHaveText("Into the fire");

  // -- Phase 2: the full ceremony -------------------------------------------
  // THREE polls armed BEFORE the click (the crumple-filter window opens
  // ~430ms in; roundtrip latency on a loaded worker could straddle thinner
  // observations — arming first makes every probe race-free):
  const ghostProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".pop-ghost");
    if (ghost === null) return null;
    const paper = ghost.querySelector(".burn-box");
    return {
      name: getComputedStyle(ghost).animationName,
      mask: paper === null ? "missing" : getComputedStyle(paper).maskImage,
      embers: document.querySelectorAll(".pop-ember").length,
    };
  });
  const crumpleProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".pop-ghost");
    return ghost !== null && getComputedStyle(ghost).filter.includes("pop-crumple") ? true : null;
  });
  await page.getByRole("button", { name: "Done" }).click();

  // The ghost runs the full ceremony, with embers, over a masked paper layer.
  const ghost = await (await ghostProbe).jsonValue();
  if (ghost === null) throw new Error("the ghost was never observed");
  expect(ghost.name).toContain("pop-ceremony");
  expect(ghost.name).not.toContain("fade");
  expect(ghost.mask).toContain("radial-gradient");
  expect(ghost.embers).toBeGreaterThan(0);
  // The SVG displacement filter arrives on cue (crumple phase).
  const crumpled = await (await crumpleProbe).jsonValue();
  if (crumpled === null) throw new Error("the crumple filter was never observed");
  expect(crumpled).toBe(true);

  // While the ghost burns: exactly one true .note-text (the revealed card's),
  // and the action row rests — one ceremony at a time (no double-pop).
  await expect(page.locator(".note-text")).toHaveCount(1);
  await expect(page.locator(".note-text")).toHaveText("Beneath the flame");
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Toss" })).toBeDisabled();

  // The revealed card settles with the reveal, never the push spring.
  const revealedCard = page.locator(".card").filter({ hasText: "Beneath the flame" });
  expect(await revealedCard.evaluate((el) => getComputedStyle(el).animationName)).toContain(
    "pop-reveal",
  );

  // The ghost extinguishes itself (animationend contract) and the row
  // re-arms; the revealed card's flag self-clears the same way.
  await expect(page.locator(".pop-ghost")).toHaveCount(0);
  await expect(page.locator(".pop-ember")).toHaveCount(0);
  await expect(done).toBeEnabled();
  await expect(revealedCard).not.toHaveClass(/revealed/);
  expect(await revealedCard.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // -- Phase 3: reduced motion → the simple fade (the done-when clause) -----
  await page.emulateMedia({ reducedMotion: "reduce" });
  const input = page.getByLabel("New note");
  await input.fill("Quiet flame");
  await page.getByRole("button", { name: "Push" }).click();
  await expect(page.locator(".note-text")).toHaveText("Quiet flame");
  // Armed BEFORE the click: the fade window is 150ms — a probe sent after
  // the text assertion's roundtrips would sit polling an already-cleared
  // DOM for the full timeout (push-motion Phase 5's hard-won pattern).
  const fadeProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".pop-ghost");
    if (ghost === null) return null;
    const paper = ghost.querySelector(".burn-box");
    const emberLayer = document.querySelector(".embers");
    const computed = getComputedStyle(ghost);
    return {
      name: computed.animationName,
      transform: computed.transform,
      mask: paper === null ? "missing" : getComputedStyle(paper).maskImage,
      // display:none elements still exist in the DOM — the suppression pin
      // reads the layer's COMPUTED display, not its child count.
      embers: emberLayer === null ? "missing" : getComputedStyle(emberLayer).display,
    };
  });
  await done.click();
  const fade = await (await fadeProbe).jsonValue();
  if (fade === null) throw new Error("the fading ghost was never observed");
  expect(fade.name).toContain("pop-ceremony-fade");
  // The fade MOVES nothing (DESIGN.md §7) — no mask, no fire, and the only
  // transform is the note's own STATIC tilt: a pure unit rotation matrix
  // (a = d, b = −c, a² + b² = 1) with zero translation.
  expect(fade.mask).toBe("none");
  expect(fade.embers).toBe("none");
  const nums = (fade.transform.match(/-?[\d.e]+/g) ?? []).map(Number);
  expect(nums).toHaveLength(6);
  const [a, b, c, d, tx, ty] = nums as [number, number, number, number, number, number];
  expect(tx).toBe(0);
  expect(ty).toBe(0);
  expect(a).toBeCloseTo(d, 6);
  expect(b).toBeCloseTo(-c, 6);
  expect(a * a + b * b).toBeCloseTo(1, 5);
  await expect(page.locator(".pop-ghost")).toHaveCount(0);
  await expect(page.locator(".note-text")).toHaveText("Beneath the flame");
  // Reset nothing — the leftover Ceremony desk is inert for later specs.
});
