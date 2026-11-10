/**
 * Toss motion e2e (T30; sources: TASKS.md T30 Done-when, DESIGN.md §7
 * "Toss: a quick crumple and the note drops out of frame. No fire for
 * tossed notes.", DECISIONS.md §4 "toss — delete a note quietly (no
 * ceremony, no archive credit)" / §7 "toss gets a brief quiet crumple").
 * Mechanically pins what the done-when's visual review can't carry in CI:
 *
 * - the toss ghost mounts on Toss wearing the FULL toss ceremony
 *   (animation name contains "toss-ceremony" — containment, not
 *   equality: Svelte appends a scope hash — and never the "-fade"
 *   fallback in full motion), with the crumple's SVG displacement filter
 *   arriving on cue (a rAF-polled predicate catches the 15%+ filter
 *   window);
 * - the paper box is NOT masked (mask-image computes to "none" — the
 *   antithesis of the pop's burn mask; DECISIONS.md §7 gives the toss no
 *   fire) and no ember/fire elements exist anywhere (.pop-ember /
 *   .toss-ember / .burn-front — all zero, the pop's vocabulary is simply
 *   absent);
 * - exactly ONE .note-text exists while the ghost lives (the ghost's
 *   text is deliberately the toss-owning .toss-ghost-text class — the
 *   surviving card beneath is the one true .note-text);
 * - the action row rests during the ceremony (the T30 double-action
 *   guard, same T29 rationale: Done/Edit/Toss disabled while the ball
 *   drops, re-enabled when it clears) while quick-add stays live (the
 *   input accepts the next note's typing mid-drop);
 * - NO reveal bounce: the survivor never runs pop-reveal (or any
 *   animation at all) — the toss is the quiet delete; DESIGN.md §7
 *   grants the bounce only to the pop's reveal;
 * - no archive credit: GET /api/state shows completed[] without the
 *   tossed note (the ONE server-truth claim here; the suite's single
 *   archive question — "does tossing a note count as Done?" — answered
 *   no, matching DECISIONS.md §4);
 * - reduced motion becomes the simple fade (TASKS.md T30 reads via
 *   DESIGN.md §7 "every animation becomes a simple fade"): an in-page
 *   poll armed BEFORE the click catches the razor-thin 150ms window —
 *   fade name, no mask, zero filter, and a purely static transform (the
 *   note's own tilt rotation only, no translation).
 *
 * ONE sequential test, deliberately (suite rule: this run's ONE DB, files
 * alphabetical, workers 1). Self-sufficient: creates its own "Toss desk"
 * stack via POST /api/stacks (which makes it ACTIVE, T10) and pushes its
 * notes via the API; it sorts LAST (toss-motion is alphabetically after
 * sync), so its leftovers (a one-pending "Toss desk") are inert for no
 * later spec. Probes are in-page evaluates (no expect inside); claims
 * are asserted back in Node.
 */
import { expect, test } from "@playwright/test";

test("a toss crumples quietly and never lights a fire", async ({ page, request }) => {
  // -- Phase 1: setup via API — a two-note pile on a fresh active stack ----
  const created = await request.post("/api/stacks", { data: { name: "Toss desk" } });
  expect(created.ok()).toBe(true);
  const state = (await created.json()) as { activeStackId: string };
  await request.post(`/api/stacks/${state.activeStackId}/notes`, {
    data: { text: "Beneath the toss" },
  });
  await request.post(`/api/stacks/${state.activeStackId}/notes`, {
    data: { text: "Toss me" },
  });
  await page.goto("/");
  await expect(page.locator(".note-text")).toHaveText("Toss me");

  // -- Phase 2: the full-motion toss ----------------------------------------
  // The token override makes the 620ms ceremony race-free (same pattern as
  // push-motion Phase 4b's --motion-push spike): the injected :root rule
  // (same specificity, later document order) stretches the ghost to 3000ms
  // and deliberately persists to the end of the test. The reduced-motion
  // phase is unaffected — the fade reads --motion-fade, not --motion-toss.
  await page.addStyleTag({ content: ":root { --motion-toss: 3000ms }" });

  // TWO polls armed BEFORE the click (the crumple-filter window opens only
  // ~450ms into the 3000ms ceremony; roundtrip latency on a loaded worker
  // could straddle thinner observations — arming first makes every probe
  // race-free. This is pop-ceremony.spec.ts's hard-won pattern, repeated).
  const ghostProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".toss-ghost");
    if (ghost === null) return null;
    const box = ghost.querySelector(".toss-box");
    // The fire vocabulary must be ABSENT: the pop's embers, a toss-side
    // ember set (if a future fire ever leaked in under a toss name), and
    // the pop's burn front — none may exist while a toss ghost lives.
    return {
      name: getComputedStyle(ghost).animationName,
      mask: box === null ? "missing" : getComputedStyle(box).maskImage,
      popEmbers: document.querySelectorAll(".pop-ember").length,
      tossEmbers: document.querySelectorAll(".toss-ember").length,
      burnFronts: document.querySelectorAll(".burn-front").length,
    };
  });
  const crumpleProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".toss-ghost");
    return ghost !== null && getComputedStyle(ghost).filter.includes("toss-crumple") ? true : null;
  });
  await page.getByRole("button", { name: "Toss" }).click();

  // The ghost runs the quiet ceremony: no fade fallback, no mask, no fire.
  const ghost = await (await ghostProbe).jsonValue();
  if (ghost === null) throw new Error("the toss ghost was never observed");
  expect(ghost.name).toContain("toss-ceremony");
  expect(ghost.name).not.toContain("fade");
  expect(ghost.mask).toBe("none");
  expect(ghost.popEmbers).toBe(0);
  expect(ghost.tossEmbers).toBe(0);
  expect(ghost.burnFronts).toBe(0);
  // The SVG displacement filter arrives on cue (crumple phase).
  const crumpled = await (await crumpleProbe).jsonValue();
  if (crumpled === null) throw new Error("the crumple filter was never observed");
  expect(crumpled).toBe(true);

  // While the ghost crumples: exactly one true .note-text (the survivor
  // beneath — the ghost's own text is .toss-ghost-text, never the durable
  // locator), the action row rests (one ceremony at a time), and the
  // quick-add stays fully live (same T29 typing-ahead rule, T30 edition:
  // filling the input mid-drop arms the Push button).
  await expect(page.locator(".note-text")).toHaveCount(1);
  await expect(page.locator(".note-text")).toHaveText("Beneath the toss");
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Toss" })).toBeDisabled();
  const input = page.getByLabel("New note");
  await expect(input).toBeEnabled();
  await input.fill("typing ahead during the drop");
  await expect(page.getByRole("button", { name: "Push" })).toBeEnabled();

  // The ghost clears itself (animationend contract) and the row re-arms.
  // NO reveal bounce: the survivor's computed animationName is "none" —
  // a toss must not spring the card beneath (only a pop earns pop-reveal;
  // pushing-motion.spec Phase 4 pins that boundary from the other side).
  const revealedCard = page.locator(".card").filter({ hasText: "Beneath the toss" });
  await expect(page.locator(".toss-ghost")).toHaveCount(0);
  expect(await revealedCard.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(done).toBeEnabled();
  await expect(page.getByRole("button", { name: "Edit" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Toss" })).toBeEnabled();

  // The one archive invariant: tossed notes are NOT Done notes
  // (DECISIONS.md §4 — no ceremony, no archive credit).
  const fresh = await request.get("/api/state");
  expect(fresh.ok()).toBe(true);
  const archived = ((await fresh.json()) as { completed: Array<{ text: string }> }).completed;
  expect(archived.some((entry) => entry.text === "Toss me")).toBe(false);

  // -- Phase 3: reduced motion → the simple fade (the §7 clause) ------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await input.fill("Quiet toss");
  await page.getByRole("button", { name: "Push" }).click();
  await expect(page.locator(".note-text")).toHaveText("Quiet toss");
  // Armed BEFORE the click (pop-ceremony.spec's rationale again): the fade
  // window is 150ms — a probe sent after the text assertion's roundtrips
  // would sit polling an already-cleared DOM for the full timeout.
  // The static-tilt claim rides the same poll's transform read: under the
  // fade the ghost's ONLY transform is the base rotate(--card-tilt) — a
  // pure unit rotation matrix (a = d, b = −c, a² + b² = 1) with ZERO
  // translation, proving the fade moves nothing.
  const fadeProbe = page.waitForFunction(() => {
    const ghost = document.querySelector(".toss-ghost");
    if (ghost === null) return null;
    const box = ghost.querySelector(".toss-box");
    const computed = getComputedStyle(ghost);
    return {
      name: computed.animationName,
      transform: computed.transform,
      filter: computed.filter,
      mask: box === null ? "missing" : getComputedStyle(box).maskImage,
    };
  });
  await page.getByRole("button", { name: "Toss" }).click();
  const fade = await (await fadeProbe).jsonValue();
  if (fade === null) throw new Error("the fading toss ghost was never observed");
  expect(fade.name).toContain("toss-ceremony-fade");
  // The fade is bare: no mask on the paper, no filter on the ghost.
  expect(fade.mask).toBe("none");
  expect(fade.filter).toBe("none");
  // And it MOVES nothing: zero translation, static tilt rotation only.
  const nums = (fade.transform.match(/-?[\d.e]+/g) ?? []).map(Number);
  expect(nums).toHaveLength(6);
  const [a, b, c, d, tx, ty] = nums as [number, number, number, number, number, number];
  expect(tx).toBe(0);
  expect(ty).toBe(0);
  expect(a).toBeCloseTo(d, 6);
  expect(b).toBeCloseTo(-c, 6);
  expect(a * a + b * b).toBeCloseTo(1, 5);
  await expect(page.locator(".toss-ghost")).toHaveCount(0);
  // The survivor ("Beneath the toss") is top again — the drop freed it.
  await expect(page.locator(".note-text")).toHaveText("Beneath the toss");
  // Reset nothing — the leftover Toss desk is inert for later specs.
});
