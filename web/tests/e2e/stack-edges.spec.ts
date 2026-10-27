/**
 * Stack peeking edges e2e (T26; sources: TASKS.md T26 Done-when, DESIGN.md
 * §2/§3/§5.1, DECISIONS.md §3).
 *
 * Exercised states: the done-when's three render states (1 / 8 / 40 notes),
 * with reload-stability pinned at 8 AND 40 (the deterministic-placement
 * contract, DECISIONS.md §3: edge placement is fixed per-note-id forever —
 * a buried note keeps its exact spot no matter what is above it) — every
 * capture is the DOM's own byte-level `style` attribute, so a regression in
 * the seam math, tokens, or ordering fails the deep-equal loudly. Plus the
 * edit-mode pile guard (the deck must NOT collapse when the short edit
 * form replaces the tall top card — footprint stability, edge-over-action
 * paint check).
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and spec files execute alphabetically — phases
 * build on each other and nothing inside may run in parallel.
 *
 * Self-sufficiency: creates its own uniquely-named "Deep desk" stack via
 * POST /api/stacks (which makes it ACTIVE, T10) and seeds every note via
 * API pushes, so no dependence on earlier specs' leftovers. Suite
 * citizenship: this file sorts alphabetically between list-view.spec.ts
 * and stack-view/stacks-drawer.spec.ts... precisely BEFORE stacks-drawer —
 * its leftovers (a 40-note "Deep desk" stack) are inert for the later
 * self-sufficient specs, and nothing may run in parallel (workers: 1 is
 * already pinned by the config).
 *
 * Server truth (`GET /api/state` through the same Vite proxy) anchors the
 * push counts. Durable locators only (.title / .note-text / .edge /
 * .scrap — the same durable-class precedent as the other specs), no
 * testids, no styling assertions. DURABILITY note on `.edge`/`.scrap`:
 * these are T26's own structural classes (count and material, not
 * styling), chosen as the e2e-facing contract in the same spirit as
 * `.note-text` — the class lives where the THING lives.
 *
 * Phase-2's implicit WS proof recurs below: notes enter VIA THE API and
 * the edges appear WITHOUT a reload — only the WS full-state broadcast
 * drives those re-renders.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** Pushes one note onto a stack via the API (server truth drives the UI). */
async function pushNote(request: APIRequestContext, stackId: string, text: string): Promise<void> {
  const response = await request.post(`/api/stacks/${stackId}/notes`, { data: { text } });
  expect(response.ok()).toBe(true);
}

test("buried edges peek deterministically through 1, 8, and 40 notes", async ({
  page,
  request,
}) => {
  // -- Phase 1: setup via API ----------------------------------------------
  // POST /api/stacks makes the new stack active (T10), so the page lands on
  // the Deep desk regardless of how many stacks earlier specs left behind.
  const created = await request.post("/api/stacks", { data: { name: "Deep desk" } });
  expect(created.ok()).toBe(true);
  // POST /api/stacks replies with the fresh AppState (creation makes it
  // active, T10); the null guard keeps TS honest the same way the other
  // specs narrow it.
  const afterCreate = (await created.json()) as AppState;
  const stackId = afterCreate.activeStackId;
  if (stackId === null) throw new Error("no active stack after POST /api/stacks");

  await page.goto("/");
  const title = page.locator(".title");

  // -- Phase 2: one note — the top card only, no edges, no scrap -----------
  await pushNote(request, stackId, "Only note on the desk");
  await expect(page.locator(".note-text")).toBeVisible();
  await expect(page.locator(".note-text")).toHaveText("Only note on the desk");
  // DESIGN.md §5.1's first state: exactly one readable card, nothing buried.
  await expect(page.locator(".edge")).toHaveCount(0);
  await expect(page.locator(".scrap")).toHaveCount(0);
  await expect(title).toContainText("1 note");

  // -- Phase 3: 8 notes — seven peeking edges, still no scrap --------------
  for (let index = 2; index <= 8; index += 1) {
    await pushNote(request, stackId, `Buried note ${index}`);
  }
  // Implicit WS-snapshot proof: these pushes came through the API untouched
  // — the edges are on the page WITHOUT any page.reload here.
  await expect(page.locator(".edge")).toHaveCount(7);
  await expect(page.locator(".scrap")).toHaveCount(0);
  await expect(title).toContainText("8 notes");
  const after8 = await stateOf(request);
  expect(after8.notes.filter((note) => note.stackId === stackId)).toHaveLength(8);
  // Edges are pure paper: no text anywhere on them, and announcement off
  // (pure decoration — DESIGN.md §3 "no text is visible on them"; the
  // a11y pass itself is T33). The values are collected in the browser and
  // asserted back in Node — evaluateAll runs in the page context, which
  // has no expect.
  const edgeProbes = await page
    .locator(".edge")
    .evaluateAll((edges) =>
      edges.map((edge) => ({ hidden: edge.getAttribute("aria-hidden"), text: edge.textContent })),
    );
  expect(edgeProbes).toHaveLength(7);
  for (const probe of edgeProbes) {
    expect(probe.hidden).toBe("true");
    expect((probe.text ?? "").trim()).toBe("");
  }

  // -- Phase 4: reload-stability at 8 ---------------------------------------
  // The deterministic contract (DECISIONS.md §3), pinned byte-exactly: the
  // style attribute covers color var, offsets, tilt, and shadow token —
  // the full T26 seam. A deep-equal over these catches any drift the
  // count-based checks above cannot.
  // Wait, then capture — locator.evaluateAll does NOT auto-wait, and after
  // a reload the app sits on the "Connecting…" placeholder until the WS
  // snapshot lands; an auto-retrying toHaveCount first makes the capture
  // race-free.
  const captureStyles = () =>
    page.locator(".edge").evaluateAll((edges) => edges.map((edge) => edge.getAttribute("style")));
  const captureTop = () => page.locator(".note-text").textContent();
  const stylesAt8 = await captureStyles();
  const topAt8 = await captureTop();
  await page.reload();
  await expect(page.locator(".edge")).toHaveCount(7);
  const stylesAt8Again = await captureStyles();
  const topAt8Again = await captureTop();
  expect(stylesAt8Again).toEqual(stylesAt8);
  expect(topAt8Again).toEqual(topAt8);

  // -- Phase 5: edit mode keeps the pile's footprint (review-fix regression
  //    guard) ----------------------------------------------------------------
  // The deck must NOT collapse when the short inline edit form replaces
  // the tall top card: a collapsed deck is re-centered by .stage, re-anchors
  // the 320px absolute edges, jumps the pile ~150px, and the edges then
  // paint OVER the .actions row (positioned element above non-positioned
  // siblings; pointer-events:none keeps the clicks going, so interactions
  // never reveal the cover-up). Three assertions below pin footprint
  // height, edge/action separation, and that the pile persists while
  // editing. UI-driven edit via the actions row's Edit button.
  const deckBox = await page.locator(".deck").boundingBox();
  if (deckBox === null) throw new Error("deck bounding box unavailable");
  await page.getByRole("button", { name: "Edit" }).click();
  // During edit the pile stays UNDER the form: all seven edges persist.
  await expect(page.locator(".edge")).toHaveCount(7);
  const deckDuringEdit = await page.locator(".deck").boundingBox();
  if (deckDuringEdit === null) throw new Error("deck bounding box unavailable");
  // (a) Footprint: ±12px around the pre-edit height — a collapsed deck
  //     loses ~290px; a correct deck holds its 320px pile height.
  expect(Math.abs(deckDuringEdit.height - deckBox.height)).toBeLessThanOrEqual(12);
  // (b) Separation: no edge's box may overlap the action row's box —
  //     measured in the page (querying getBoundingClientRect), asserted
  //     in Node (page.evaluate has no expect).
  const boxes = await page.evaluate(() => {
    const actionsTop =
      document.querySelector(".actions")?.getBoundingClientRect().top ?? Number.MAX_SAFE_INTEGER;
    const edgeBottoms = Array.from(
      document.querySelectorAll(".edge"),
      (edge) => edge.getBoundingClientRect().bottom,
    );
    return { actionsTop, maxEdgeBottom: Math.max(...edgeBottoms) };
  });
  expect(boxes.maxEdgeBottom).toBeLessThanOrEqual(boxes.actionsTop + 1);
  // (c) The edit UI still works and Cancel restores the reading view —
  //     T18 owns the full edit flow; this only guards the pile.
  await expect(page.getByLabel("Note text")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".note-text")).toBeVisible();

  // -- Phase 6: 40 notes — the cap + "+25 more" scrap -----------------------
  for (let index = 9; index <= 40; index += 1) {
    await pushNote(request, stackId, `Deep buried note ${index}`);
  }
  // DESIGN.md §5.1's own numbers: 40 notes → up to 14 edges (positions
  // 2–15) + a scrap reading exactly "+25 more", title says 40.
  await expect(page.locator(".edge")).toHaveCount(14);
  await expect(page.locator(".scrap")).toHaveCount(1);
  await expect(page.locator(".scrap")).toHaveText("+25 more");
  await expect(title).toContainText("40 notes");
  const after40 = await stateOf(request);
  expect(after40.notes.filter((note) => note.stackId === stackId)).toHaveLength(40);

  // -- Phase 7: reload-stability at 40 --------------------------------------
  // Same capture/compare as Phase 4 (wait-then-capture, same rationale),
  // deep in the pile: the two deepest fates (an edge at position 15, the
  // scrap) also hold byte-exactly across a reload.
  const stylesAt40 = await captureStyles();
  const scrapAt40 = await page.locator(".scrap").textContent();
  await page.reload();
  await expect(page.locator(".edge")).toHaveCount(14);
  await expect(page.locator(".scrap")).toHaveText("+25 more");
  expect(await captureStyles()).toEqual(stylesAt40);
  expect(await page.locator(".scrap").textContent()).toEqual(scrapAt40);

  // -- Phase 8: regression guard — mobile viewport stays inside its width ---
  // T28 owns the responsive layout; T26 must merely not REGRESS the
  // document: 15 stacked cards' absolute edges (±6–10px) must never open a
  // horizontal scrollbar at a narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);
});
