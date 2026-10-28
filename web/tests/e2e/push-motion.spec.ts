/**
 * Push motion e2e (T27; sources: TASKS.md T27 Done-when, DESIGN.md §7,
 * DECISIONS.md §3/§7/§11).
 *
 * Exercised states: the full-motion push landing (the top card wears the
 * `landing` class AND runs an animation whose name contains "push-land" —
 * containment, not equality: Svelte scoping appends a hash to keyframe
 * names), the class clearing itself on animationend, the honest-landing
 * rule (reload → zero animation: DECISIONS.md §3's deterministic rest
 * state survives the reload, Phase 3), done-reveal NOT re-springing (the
 * reveal ceremony is T29's, never the push spring's job), edit-mode
 * stillness (Edit→Cancel during a live landing never replays the drop,
 * Phase 4b — the `startEdit` flag clear, asserted with NON-retrying
 * reads so it can actually fail; push-during-edit auto-cancels the form
 * and the new note still lands, Phase 4c), two stillness invariants (the
 * paused 100% frame settles to the natural rest matrix, Phase 4b; the
 * fade moves nothing, Phase 5), and reduced
 * motion → the plain fade fallback ("push-fade", never "push-land",
 * caught by an in-page poll armed BEFORE the push) — this phase
 * mechanically pins T27's done-when clause "reduced-motion emulation
 * shows the fade fallback".
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and spec files execute alphabetically —
 * phases build on each other and nothing inside may run in parallel.
 *
 * Self-sufficiency: creates its own uniquely-named "Motion desk" stack via
 * POST /api/stacks (which makes it ACTIVE, T10), so no dependence on
 * earlier specs' leftovers. Suite citizenship: this file sorts
 * alphabetically between list-view.spec.ts and stack-edges.spec.ts; its
 * leftovers (a few-pendings "Motion desk" stack) are inert for the later
 * self-sufficient specs, and nothing may run in parallel (workers: 1 is
 * already pinned by the config).
 *
 * Self-sufficient stack creation only: the ONE API call is POST /api/stacks
 * (which makes it active, T10); no `GET /api/state` reads — every claim
 * here is UI/DOM-side, verifiable against the page itself, so no
 * server-truth anchor is needed. Durable structural locators only
 * (.title / .note-text / .card — the `landing` class is part
 * of this spec's durable contract in the same spirit as T26's
 * `.edge`/`.scrap`: the class lives where the THING lives; its CSS look is
 * the visual review's business, not e2e's). Asserted via `getComputedStyle`
 * probes run in the page (evaluate has no expect) and asserted back in
 * Node.
 */
import { expect, test } from "@playwright/test";

test("the push lands with a spring, and motion stays honest everywhere else", async ({
  page,
  request,
}) => {
  // -- Phase 1: setup via API ----------------------------------------------
  // POST /api/stacks makes the new stack active (T10), so the page lands on
  // the Motion desk regardless of earlier specs' pursuits.
  const created = await request.post("/api/stacks", { data: { name: "Motion desk" } });
  expect(created.ok()).toBe(true);
  await page.goto("/");

  const input = page.getByLabel("New note");
  const push = page.getByRole("button", { name: "Push" });

  // -- Phase 2: full-motion push via UI → the spring -----------------------
  // Pushing VIA THE UI (not the API) so the landing path is the exact
  // local-user one: snapshot diff → landing flag → keyed remount → class.
  await input.fill("Landing probe");
  await push.click();
  await expect(page.locator(".note-text")).toHaveText("Landing probe");

  const landingCard = page.locator(".card").filter({ hasText: "Landing probe" });
  await expect(landingCard).toHaveClass(/landing/);
  // The spring's animation name contains "push-land" (containment, not
  // equality — Svelte appends a scope-hash suffix to scoped keyframes).
  // Probe while the animation is live, then let it end: the class MUST
  // clear itself on the card's animationend (onLanded) — a lingering flag
  // would keep the drop's class on the card through an edit (T28: the
  // card is concealed in flow under the form, NOT unmounted) and hand it
  // to the next keyed remount.
  // (Two plain roundtrips are enough HERE: the full-motion window is
  // 520ms — ~3.5× the fade's — so the probe frames cannot straddle;
  // Phase 5's 150ms window gets the retrying in-page poll instead.)
  expect(await landingCard.evaluate((el) => getComputedStyle(el).animationName)).toContain(
    "push-land",
  );
  await expect(landingCard).not.toHaveClass(/landing/);

  // -- Phase 3: reload → no animation + rest determinism --------------------
  // DECISIONS.md §3/T25: the DETERMINISTIC REST STATE survives a reload —
  // the settled card's computed transform is captured before the reload
  // (the animation is over: the class wait above already removed the fill)
  // and the reloaded card's is identical. This pins "reload → identical
  // placement" and that the landing detector's first observation after
  // mount is null (no animation, `animationName: "none"` on the fresh
  // card). It is deliberately NOT the 100%-keyframe claim: with the
  // animation removed, both sides read the `.card` rest rule, so the
  // filled-end-frame contract gets its own direct probe in Phase 4b.
  const settledCard = landingCard;
  const transformBefore = await settledCard.evaluate((el) => getComputedStyle(el).transform);
  await page.reload();
  await expect(page.locator(".note-text")).toHaveText("Landing probe");
  const reloadedCard = page.locator(".card").filter({ hasText: "Landing probe" });
  await expect(reloadedCard).not.toHaveClass(/landing/);
  expect(await reloadedCard.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await reloadedCard.evaluate((el) => getComputedStyle(el).transform)).toBe(transformBefore);

  // -- Phase 4: Done reveal does NOT re-spring ------------------------------
  // Push a second note (it lands — its own drop, fine), then Done it: the
  // REVEALED note beneath must arrive still. The reveal ceremony is T29's;
  // if the push spring replayed here, every done would double-celebrate.
  await input.fill("Done probe");
  await push.click();
  await expect(page.locator(".note-text")).toHaveText("Done probe");
  const doneCard = page.locator(".card").filter({ hasText: "Done probe" });
  await expect(doneCard).toHaveClass(/landing/);
  await expect(doneCard).not.toHaveClass(/landing/); // its own landing is over
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".note-text")).toHaveText("Landing probe");
  const revealedCard = page.locator(".card").filter({ hasText: "Landing probe" });
  await expect(revealedCard).not.toHaveClass(/landing/);
  expect(await revealedCard.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // -- Phase 4b: Edit during a live landing never replays the drop ----------
  // The subsequent phases need a HUGE animation window to be race-free:
  // from here on the push token is overridden by an injected <style> tag —
  // same :root specificity, later document order wins. The override
  // deliberately persists to the end of the test (3000ms landings are the
  // only observable side effect); Phase 5 is unaffected because the fade
  // reads --motion-fade, not --motion-push.
  await page.addStyleTag({ content: ":root { --motion-push: 3000ms }" });
  await input.fill("Edit probe");
  await push.click();
  const editCard = page.locator(".card").filter({ hasText: "Edit probe" });
  await expect(editCard).toHaveClass(/landing/); // 3000ms window → no race

  // The 100%-keyframe contract, pinned for real (this is the seam a
  // keyframe edit could break — Phase 3's reload capture cannot reach it,
  // it samples the REST rule twice): ONE atomic in-page evaluate on the
  // landing card (atomic → race-free). It pauses the live animation,
  // seeks to its duration (the filled 100% frame — `fill-mode: both` makes
  // the keyframe authoritative there), reads the computed matrix, then
  // reads the natural rest-rule matrix.
  // anim.cancel() is deliberate: cancel fires NO animationend, so
  // onLanded never runs and landingId stays set — harmless HERE, because
  // the immediately following Edit click clears it via startEdit(), and
  // the card already displays at rest.
  const matrices = await editCard.evaluate((el) => {
    const anim = el.getAnimations()[0];
    if (!anim) return null;
    anim.pause();
    // Number(): getTiming().duration is CSSNumberish in the DOM lib — a
    // CSSDuration string would also set currentTime, but the Number seam
    // keeps the callback TS-clean.
    anim.currentTime = Number(anim.effect?.getTiming().duration ?? 0); // seek to the 100% frame
    const endFrame = getComputedStyle(el).transform; // the FILLED 100% keyframe matrix
    anim.cancel(); // no animationend fires on cancel
    const rest = getComputedStyle(el).transform; // the natural rest-rule matrix
    return { endFrame, rest };
  });
  // T|null sentinel (documented), same narrowing pattern as the specs use.
  if (matrices === null) throw new Error("no landing animation found on the 4b card");
  expect(matrices.endFrame).toBe(matrices.rest);

  // Interrupt mid-fall: Edit CONCEALS the card in flow for the inline form
  // (T28: visibility:hidden — the card stays mounted under the overlaying
  // form; the pile's box never moves), then Cancel merely reveals it
  // again — no remount. The animation is ALREADY dead by now — the
  // 100% probe above canceled it (cancel fires no animationend), so
  // `animationend` never ran and `landingId` is still set: the flag-clear
  // inside startEdit() is the ONLY guard this phase exercises — pin it here since
  // the architecture depends on it: without the clear, the stale flag
  // would keep the landing class on the card through the whole edit (and
  // hand it to the next keyed remount on a push-during-edit) instead of
  // the class being removed the moment Edit is clicked.
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Note text")).toBeVisible(); // the form is up
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".note-text")).toHaveText("Edit probe"); // revealed again
  // NON-RETRYING reads, deliberately: a retrying ABSENCE assertion
  // (toHaveClass not.toHaveClass) would wait out the replayed 3000ms drop
  // it is supposed to fail against — animationend clears the stale flag
  // at ~3s, inside the default 5s expect timeout, and the phase would pass
  // VACUOUSLY with the bug present. These two are immediate snapshots of
  // the just-revealed card (the reveal is already confirmed by the text
  // assertion above).
  expect(await editCard.evaluate((el) => el.classList.contains("landing"))).toBe(false);
  expect(await editCard.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // -- Phase 4c: Push while the edit form is open lands ---------------------
  // The current top (Edit probe) is in edit mode; pushing against it
  // auto-cancels the edit (the existing T18 $effect — the edited note left
  // the top slot) and the new note arrives WITH its landing, form and all.
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Note text")).toBeVisible();
  await input.fill("Crowd probe");
  await push.click();
  await expect(page.locator(".note-text")).toHaveText("Crowd probe");
  // The form auto-canceled: exactly ZERO "Note text" labels remain.
  await expect(page.getByLabel("Note text")).toHaveCount(0);
  const crowdCard = page.locator(".card").filter({ hasText: "Crowd probe" });
  await expect(crowdCard).toHaveClass(/landing/); // 3000ms window → no race
  const pushMidEditName: string = await crowdCard.evaluate(
    (el) => getComputedStyle(el).animationName,
  );
  expect(pushMidEditName).toContain("push-land");

  // -- Phase 5: reduced motion → the fade (moves nothing) -------------------
  // T27's done-when clause, pinned mechanically: under
  // prefers-reduced-motion the landing runs "push-fade" and NEVER
  // "push-land" (a plain opacity fade, no transform — DESIGN.md §7).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await input.fill("Quiet probe");
  // The poll is created BEFORE the click: waiting for the new top's text
  // first would burn >150ms of roundtrip latency on a loaded worker and
  // the poll would miss the razor-thin fade window entirely (it would sit
  // polling on an already-cleared card for the full 5s timeout). ONE
  // retrying in-page poll, not two roundtrips: a toHaveClass probe
  // followed by a separate evaluate can straddle the window (class
  // already cleared, name gone). The predicate is self-selecting — it
  // matches the landing card whose .note-text is EXACTLY this phase's
  // probe text, so an earlier top card still wearing a suppressed second
  // landing (none can be, but belt-and-braces) cannot satisfy it. It
  // returns the animation name AND computed transform together: the name
  // is the one the card actually ran, the transform is a fading frame for
  // the fade's stillness half of this phase's invariant.
  const fadingProbe = page.waitForFunction(
    (probeText) => {
      const card = document.querySelector(".card.landing");
      if (card === null || card.querySelector(".note-text")?.textContent !== probeText) {
        return null;
      }
      const computed = getComputedStyle(card);
      return { name: computed.animationName, transform: computed.transform };
    },
    "Quiet probe",
    { timeout: 5_000 },
  );
  await push.click();
  // Poll result is T | null (the null sentinel); the guard keeps TS honest
  // the same way the specs narrow their state responses.
  const fadedProbe = await fadingProbe; // the poll's settled JSHandle
  const faded = await fadedProbe.jsonValue();
  if (faded === null) throw new Error("the fading landing card was never observed");
  expect(faded.name).toContain("push-fade");
  expect(faded.name).not.toContain("push-land");
  // DESIGN.md §7 "every animation becomes a simple fade": the fade moves
  // NOTHING — the card is pinned at its rest transform from the first
  // fading frame, and it settles to the very same matrix. Both captured
  // above/in this order: the mid-fade frame's transform (from the poll)
  // must equal the settled card's transform once the fade is over (the
  // class self-clears via the fade's animationend → onLanded).
  const fadedCard = page.locator(".card").filter({ hasText: "Quiet probe" });
  await expect(fadedCard).not.toHaveClass(/landing/);
  const settledAfterFade = await fadedCard.evaluate((el) => getComputedStyle(el).transform);
  expect(settledAfterFade).toBe(faded.transform);
  // Reset nothing — the leftover Motion desk is inert for later specs.
});
