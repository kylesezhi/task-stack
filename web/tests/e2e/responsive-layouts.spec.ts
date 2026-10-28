/**
 * Responsive layouts e2e (T28; sources: TASKS.md T28 Done-when, DESIGN.md
 * §8 "Responsive behavior" / §5.1 desktop+mobile layouts, DECISIONS.md §10
 * "responsive web app, desktop + mobile" / §11 evergreen browsers).
 *
 * Exercised states: the T28 Done-when's two walkthrough widths, pinned
 * mechanically — at ~390px (phone) and 1280px+ (desktop ambient) there is
 * NO horizontal scroll anywhere (desk and all three sheets) and every
 * control is reachable, plus the §5.1 mobile commitments as geometry:
 * the quick-add slip pinned bottom (sticky) and fully inside the viewport,
 * thumb-sized Done/Edit/Toss floors, the pile silhouette formula from
 * tokens.css (--pile-w: min(320px, (100vw−40px)/1.13) — 390 → ≈310, pinned
 * two-sided in Phase 2), the 640px breakpoint boundary (mobile ≤640,
 * desktop ≥641), worst-case content (a 280-char unbroken token —
 * NOTE_TEXT_MAX_LENGTH — on the desk and in the list sheet, plus the
 * accepted-residual AABB bound from tokens.css pinned in Phase 4), the
 * T28-earmarked tall-note edit fix (the §5.1 pile keeps its footprint
 * while the edit form overlays the concealed card — deck height unchanged
 * ±12px, the same tolerance stack-edges.spec.ts Phase 5 pins for short
 * notes), and — Phase 9 — a valid 80-char stack name (STACK_NAME_MAX_
 * LENGTH) driven through every surface that renders it: the desk chrome
 * title (wrap guard), the list sheet header (h2 wrap guard), an archive
 * chip (ellipsis guard, after the tall note is Done-d through the UI) and
 * the drawer's delete-confirm modal (min(24rem, 100%) + backdrop-gutter
 * fit) — the coverage behind the two long-name overflow guards.
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and spec files execute alphabetically —
 * phases build on each other and nothing inside may run in parallel
 * (workers: 1 is already pinned by the config).
 *
 * Suite citizenship: this file sorts alphabetically between
 * push-motion.spec.ts and stack-edges.spec.ts. Self-sufficiency: it
 * creates its own uniquely-named "Layout desk" stack via POST /api/stacks
 * (which makes it ACTIVE, T10) and seeds every note via API pushes, so no
 * dependence on earlier specs' leftovers. End state: its leftovers (a
 * stack renamed to an 80-char "LLL…" name in Phase 9 — never renamed
 * back, deliberately — with 5 pending "Layout note N" notes; the 280-char
 * token was Done-d in Phase 9, so a completed entry persists too, carrying
 * the long stack_name) are INERT for the later self-sufficient specs —
 * they create their own active stacks (stack-edges' "Deep desk",
 * stack-view's "Errands", …), filter rows by their own names, and derive
 * counts from within-spec baselines, so an oddly-named inactive stack with
 * a long-named archive entry harms no one.
 *
 * No `GET /api/state` reads: the create/push replies carry the fresh
 * AppState (push-motion.spec.ts precedent) and every claim here is
 * UI/DOM-side. Durable structural locators only (.title/.deck/.card/
 * .edge/.quick-add/.overlay, getByRole/getByLabel) — the GEOMETRY is this
 * spec's durable contract, so the few numeric assertions are deliberate
 * and each cites the rule it pins. Rotation note on every card probe:
 * getBoundingClientRect's width is the rotated AABB (it overshoots the
 * card by up to h·sin6°), so card WIDTH is read from offsetWidth (layout
 * width, rotation-free) while the CENTER still comes from the AABB
 * (rotation about the center preserves it).
 *
 * Scroll probes measure TWO boxes: the document — `scrollingElement.
 * scrollWidth` vs `scrollingElement.clientWidth`, the LAYOUT viewport —
 * and, when a sheet is open, the .overlay sheet's own scrollWidth ≤
 * clientWidth. clientWidth (not window.innerWidth) is the honest document
 * comparator: innerWidth includes a classic scrollbar where one exists
 * (up to ~15px of real overflow would pass against it); the two are
 * identical in THIS headless harness (Chromium reserves no classic
 * scrollbar — clientWidth === innerWidth === 390 on a scrolling page) but
 * clientWidth is the correct number everywhere. The sheet probe was
 * already clientWidth-based, and remains the only probe that can see
 * inside a sheet at all: the sheets are position:fixed, so their internal
 * overflow can NEVER reach the document's scrollWidth — without it the
 * "no h-scroll while open" claim would be vacuous exactly where the
 * 280-char list guard has to prove itself.
 */
import { expect, test, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

const STACK = "Layout desk";
/** The handful of setup notes ("Layout note 1..N"); the tall probe note
 * comes later, so desk counts are NOTE_COUNT and NOTE_COUNT + 1. */
const NOTE_COUNT = 5;
/** The worst case the sheets must survive: one 280-char unbroken token
 * (exactly NOTE_TEXT_MAX_LENGTH, shared/src/validation.ts). */
const TALL_TEXT = "m".repeat(280);
/** The other worst case, Phase 9: a valid 80-char unbroken stack name
 * (exactly STACK_NAME_MAX_LENGTH, shared/src/validation.ts) driven through
 * every surface that renders a stack name. */
const LONG_NAME = "L".repeat(80);

/** The phone walkthrough viewport (TASKS.md T28's ~390px) and its height. */
const PHONE = { width: 390, height: 844 };

/**
 * The no-h-scroll probe (head comment): document-level always (scrollWidth
 * vs the layout viewport's clientWidth — the classic-scrollbar-honest
 * comparator); the open sheet's own box when one exists (null on the bare
 * desk).
 */
async function scrollProbe(page: Page): Promise<{
  doc: { scrollWidth: number; clientWidth: number };
  sheet: { scrollWidth: number; clientWidth: number } | null;
}> {
  return page.evaluate(() => {
    const doc = {
      scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
      clientWidth: document.scrollingElement?.clientWidth ?? 0,
    };
    const overlay = document.querySelector(".overlay");
    const sheet =
      overlay instanceof HTMLElement
        ? { scrollWidth: overlay.scrollWidth, clientWidth: overlay.clientWidth }
        : null;
    return { doc, sheet };
  });
}

/** Both halves of a scroll probe, asserted in Node (evaluate has no
 * expect — the specs' standard evaluate-then-assert shape). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const probe = await scrollProbe(page);
  expect(probe.doc.scrollWidth).toBeLessThanOrEqual(probe.doc.clientWidth);
  if (probe.sheet !== null) {
    expect(probe.sheet.scrollWidth).toBeLessThanOrEqual(probe.sheet.clientWidth);
  }
}

/**
 * The top card's geometry (head comment): `width` is offsetWidth (layout
 * width — the rotation-free silhouette number the tokens formula pins),
 * `center` is the AABB's horizontal center (rotation preserves the
 * center, so this IS the card's center). null ⇒ no card (empty desk).
 */
async function cardProbe(page: Page): Promise<{ width: number; center: number } | null> {
  return page.evaluate(() => {
    const card = document.querySelector(".card");
    if (!(card instanceof HTMLElement)) return null;
    const rect = card.getBoundingClientRect();
    return { width: card.offsetWidth, center: rect.left + rect.width / 2 };
  });
}

test("the desk and its sheets stay inside the viewport at every breakpoint", async ({
  page,
  request,
}) => {
  // -- Phase 1: setup via API ----------------------------------------------
  // POST /api/stacks makes the new stack active (T10), so the page lands
  // on the Layout desk regardless of earlier specs' leftovers.
  const created = await request.post("/api/stacks", { data: { name: STACK } });
  expect(created.ok()).toBe(true);
  const afterCreate = (await created.json()) as AppState;
  const stackId = afterCreate.activeStackId;
  if (stackId === null) throw new Error("no active stack after POST /api/stacks");
  for (let index = 1; index <= NOTE_COUNT; index += 1) {
    const pushed = await request.post(`/api/stacks/${stackId}/notes`, {
      data: { text: `Layout note ${index}` },
    });
    expect(pushed.ok()).toBe(true);
  }
  await page.goto("/");
  await page.setViewportSize(PHONE);
  // Wait, then capture (stack-edges' Phase-4 rationale): the app boots on
  // the Connecting placeholder until the WS snapshot lands. 5 notes → 4
  // peeking edges (positions 2..5, under the 14-edge cap).
  await expect(page.locator(".edge")).toHaveCount(4);

  // -- Phase 2: mobile stack view @390 — the §5.1 mobile layout ------------
  // (a) No horizontal scroll on the desk (the T26 Phase-8 pattern, with
  //     the layout-viewport comparator — head comment: clientWidth is
  //     identical to innerWidth in this scrollbar-less harness but is the
  //     honest number where a classic scrollbar exists).
  const deskProbe = await scrollProbe(page);
  expect(deskProbe.sheet).toBeNull(); // no sheet open on the bare desk
  expect(deskProbe.doc.scrollWidth).toBeLessThanOrEqual(deskProbe.doc.clientWidth);
  // (b) The pinned quick-add is fully inside the viewport (§5.1 "pinned to
  //     the bottom, thumb-reachable"): with short content the strip sits
  //     at the 100dvh desk's bottom edge — boundingBox bottom ≤ 844.
  const quickAdd = await page.locator(".quick-add").boundingBox();
  if (quickAdd === null) throw new Error("quick-add bounding box unavailable");
  expect(quickAdd.y + quickAdd.height).toBeLessThanOrEqual(PHONE.height);
  // (c) Thumb-sized floors (the explicit T28 requirement; the mobile CSS
  //     is min-height 48 / 44 — asserted with 1px tolerance against
  //     subpixel rounding): Done ≥ 47, Edit and Toss ≥ 43.
  const done = await page.getByRole("button", { name: "Done" }).boundingBox();
  if (done === null) throw new Error("Done bounding box unavailable");
  expect(done.height).toBeGreaterThanOrEqual(47);
  const edit = await page.getByRole("button", { name: "Edit" }).boundingBox();
  if (edit === null) throw new Error("Edit bounding box unavailable");
  expect(edit.height).toBeGreaterThanOrEqual(43);
  const toss = await page.getByRole("button", { name: "Toss" }).boundingBox();
  if (toss === null) throw new Error("Toss bounding box unavailable");
  expect(toss.height).toBeGreaterThanOrEqual(43);
  // (d) The T26 Phase-5 invariant AT THE PHONE WIDTH — no buried edge's
  //     box may overlap the action row's box (measured in the page,
  //     asserted in Node; page.evaluate has no expect). stack-edges pins
  //     this invariant only on desktop; at 390 it is the mobile stage's
  //     min-height reserve (StackView's ≤640 block: pile floor + 2 × the
  //     ~30px edge poke) that holds it, so this is the regression guard
  //     for the flex:none composition change. +1px is the same tolerance
  //     stack-edges Phase 5 uses.
  const separation = await page.evaluate(() => {
    const actions = document.querySelector(".actions");
    if (!(actions instanceof HTMLElement)) return null;
    const actionsTop = actions.getBoundingClientRect().top;
    const maxEdgeBottom = Math.max(
      ...Array.from(
        document.querySelectorAll(".edge"),
        (edge) => edge.getBoundingClientRect().bottom,
      ),
    );
    return { actionsTop, maxEdgeBottom };
  });
  if (separation === null) throw new Error("actions row not found");
  expect(separation.maxEdgeBottom).toBeLessThanOrEqual(separation.actionsTop + 1);
  // (e) The pile silhouette (tokens.css --pile-w): the card is horizontally
  //     centered (|center − 195| ≤ 10 — the desk's symmetric gutters center
  //     the pile; no vertical scrollbar exists at this content height, so
  //     195 is the exact layout midpoint) and its layout width is pinned
  //     TWO-SIDED: the formula yields (390−40)/1.13 ≈ 309.7 → offsetWidth
  //     310, so >300 catches an over-narrowed pile and ≤316 fails loudly
  //     on any regression to the old flat 320 / min(320px, 90vw) literal
  //     (a one-sided ≤336 bound would wave a flat-320 regression through).
  const card = await cardProbe(page);
  if (card === null) throw new Error("top card not found");
  expect(Math.abs(card.center - PHONE.width / 2)).toBeLessThanOrEqual(10);
  expect(card.width).toBeGreaterThan(300);
  expect(card.width).toBeLessThanOrEqual(316);

  // -- Phase 3: mobile overlays walkthrough @390 ----------------------------
  // Each sheet: open durably, prove no h-scroll (document AND the sheet's
  // own fixed box — head comment), exercise one control, Close; close each
  // before the next.
  // (a) Stacks drawer.
  await page.getByRole("button", { name: "Stacks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // The drawer row's kebab opens its menu (thumb-sized per T28 §9).
  await page.getByRole("button", { name: `Actions for ${STACK}` }).click();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  // Close is reachable (§8 "all controls reachable").
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toHaveCount(0);
  // (b) List sheet ("See all N").
  await page.getByRole("button", { name: `See all ${NOTE_COUNT}` }).click();
  await expect(page.getByRole("heading", { name: `${STACK} — ${NOTE_COUNT} notes` })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // A row edit round-trip works in the sheet (row-action + Cancel).
  const row = page.getByRole("listitem").filter({ hasText: "Layout note 3" });
  await row.getByRole("button", { name: "Edit" }).click();
  const listInput = page.getByLabel("Note text");
  await expect(listInput).toBeVisible();
  await listInput.fill("   "); // whitespace guard: Save stays disabled
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Note text")).toHaveCount(0); // edit form gone
  // The sheet itself survived the Esc-free Cancel (T19's layering).
  await expect(page.getByRole("heading", { name: `${STACK} — ${NOTE_COUNT} notes` })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: `${STACK} — ${NOTE_COUNT} notes` })).toHaveCount(
    0,
  );
  // (c) Archive sheet.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toHaveCount(0);

  // -- Phase 4: worst-case content @390 — the 280-char unbroken token ------
  // Pushed via API so it becomes the TOP note (WS re-render, no reload).
  const tall = await request.post(`/api/stacks/${stackId}/notes`, { data: { text: TALL_TEXT } });
  expect(tall.ok()).toBe(true);
  await expect(page.locator(".note-text")).toHaveText(TALL_TEXT);
  // Wait for the push landing to settle BEFORE the scroll probe (the
  // push-motion Phase-2 pattern — the class clears on animationend): the
  // landing's mid-fall keyframes rotate at 2.5× tilt and scale 1.05, so
  // the card's transient AABB overshoots any viewport during the 520ms
  // fall. The T28 contract is the SETTLED pile's layout; the animation's
  // transient frames are T27's (motion is out of T28's scope), so the
  // probe waits them out instead of asserting against them.
  await expect(page.locator(".card")).not.toHaveClass(/landing/);
  // The desk still holds its width with the token card on top.
  await expectNoHorizontalScroll(page);
  // The accepted-residual bound (tokens.css' ACCEPTED RESIDUAL paragraph),
  // pinned mechanically while the worst case is on screen: the tall top
  // card's rotated AABB (≈381px at the 280-char worst case) may poke at
  // most ±8px past the layout viewport — 0 expected HERE (this headless
  // harness and all phones use overlay scrollbars), and the bound fails
  // loudly if the silhouette, the tilt range, or the card growth ever
  // regress past the documented residual. One evaluate captures the AABB
  // and the layout viewport together (evaluate has no expect — asserted
  // in Node).
  const residual = await page.evaluate(() => {
    const card = document.querySelector(".card");
    if (!(card instanceof HTMLElement)) return null;
    const rect = card.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  if (residual === null) throw new Error("top card not found");
  expect(residual.left).toBeGreaterThanOrEqual(-8);
  expect(residual.right).toBeLessThanOrEqual(residual.clientWidth + 8);
  // The list sheet still holds its width — the overflow-wrap guard (§9):
  // a sheet is position:fixed, so this is only provable by the sheet's own
  // scrollWidth (head comment).
  // Scroll first, deliberately: with a ~700px card (the verified tall-card
  // height at ~310px width) the pinned quick-add
  // strip (sticky, bottom: 0) covers the "See all" link's click point at
  // scrollTop 0 — scrolling it clear of the strip is the honest mobile
  // behavior (§8 "all controls reachable" includes by scrolling).
  await page.evaluate(() => window.scrollBy(0, 48));
  await page.getByRole("button", { name: `See all ${NOTE_COUNT + 1}` }).click();
  await expect(
    page.getByRole("heading", { name: `${STACK} — ${NOTE_COUNT + 1} notes` }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole("listitem").filter({ hasText: TALL_TEXT })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByRole("heading", { name: `${STACK} — ${NOTE_COUNT + 1} notes` }),
  ).toHaveCount(0);

  // -- Phase 5: tall-content pinning @390 — the sticky proof ----------------
  // The tall card makes the desk genuinely scroll...
  const scrollHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
  expect(scrollHeight).toBeGreaterThan(PHONE.height);
  // ...and at scrollTop 0 the quick-add is STILL fully inside the viewport:
  // without position:sticky its natural (flow) position would be below the
  // fold, under ~700px of card plus the rows above it.
  await page.evaluate(() => window.scrollTo(0, 0));
  const pinned = await page.locator(".quick-add").boundingBox();
  if (pinned === null) throw new Error("quick-add bounding box unavailable");
  expect(pinned.y).toBeGreaterThanOrEqual(0);
  expect(pinned.y + pinned.height).toBeLessThanOrEqual(PHONE.height);

  // -- Phase 6: tall-note edit stability @390 — the §5.1-earmarked fix -----
  // THE T28 fix, pinned: entering edit on a TALL top note must move
  // nothing (±12px, stack-edges Phase 5's tolerance). Pre-T28 the card
  // unmounted for the form, the deck collapsed to its 320px floor, and
  // the pile jumped by ~half the overflow; now the card stays in flow,
  // concealed (visibility:hidden) beneath the overlaying form.
  const deckBefore = await page.locator(".deck").boundingBox();
  if (deckBefore === null) throw new Error("deck bounding box unavailable");
  await page.getByRole("button", { name: "Edit" }).click();
  const editInput = page.getByLabel("Note text");
  await expect(editInput).toBeVisible();
  const deckDuring = await page.locator(".deck").boundingBox();
  if (deckDuring === null) throw new Error("deck bounding box unavailable");
  expect(Math.abs(deckDuring.height - deckBefore.height)).toBeLessThanOrEqual(12);
  // Cancel restores the reading view (the concealed card becomes visible).
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".note-text")).toBeVisible();

  // -- Phase 7: breakpoint behavior — 640 mobile / 700 desktop / 1280+ -----
  // The single 640px breakpoint (tokens.css documents it), pinned from
  // both sides.
  // 640 (≤ 640): mobile — thumb-sized Done, pinned quick-add.
  await page.setViewportSize({ width: 640, height: 844 });
  const doneAt640 = await page.getByRole("button", { name: "Done" }).boundingBox();
  if (doneAt640 === null) throw new Error("Done bounding box unavailable");
  expect(doneAt640.height).toBeGreaterThanOrEqual(47);
  expect(await page.locator(".quick-add").evaluate((el) => getComputedStyle(el).position)).toBe(
    "sticky",
  );
  // 700 (> 640): desktop — the flat 320px cap (--pile-h stays 320 at every
  // width; --pile-w hits its 320px cap above ≈402px) and the in-flow
  // quick-add (no sticky outside the mobile block).
  await page.setViewportSize({ width: 700, height: 844 });
  const cardAt700 = await cardProbe(page);
  if (cardAt700 === null) throw new Error("top card not found");
  expect(Math.abs(cardAt700.width - 320)).toBeLessThanOrEqual(1);
  expect(await page.locator(".quick-add").evaluate((el) => getComputedStyle(el).position)).toBe(
    "static",
  );
  // 1280×800: the Done-when's desktop ambient width — no h-scroll, the
  // flat cap again, the pile centered, quick-add in flow. Center
  // tolerance 12 covers the vertical scrollbar this tall content drags
  // in (a classic 15px scrollbar re-centers within the layout viewport:
  // |632.5 − 640| = 7.5; overlay scrollbars would be exact).
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoHorizontalScroll(page);
  const cardAt1280 = await cardProbe(page);
  if (cardAt1280 === null) throw new Error("top card not found");
  expect(Math.abs(cardAt1280.width - 320)).toBeLessThanOrEqual(1);
  expect(Math.abs(cardAt1280.center - 640)).toBeLessThanOrEqual(12);
  expect(await page.locator(".quick-add").evaluate((el) => getComputedStyle(el).position)).toBe(
    "static",
  );

  // -- Phase 8: reload determinism @390 -------------------------------------
  // T26's reload-stability contract, extended to a narrow viewport: the
  // card's layout width and every edge's byte-level style attribute are
  // identical across a reload at 390. Wait-then-capture (stack-edges'
  // Phase-4 rationale): after a reload the app sits on the Connecting
  // placeholder until the WS snapshot lands — wait for the edge count
  // FIRST, then capture. The count is a literal with its derivation, not
  // a constant: 6 notes (5 + the tall one) → positions 2..6 → 5 edges
  // (under the 14-edge cap), the same arithmetic Phase 1 spells out for
  // its 5-notes → 4-edges wait.
  await page.setViewportSize(PHONE);
  await expect(page.locator(".edge")).toHaveCount(5);
  const before = await page.evaluate(() => {
    const card = document.querySelector(".card");
    if (!(card instanceof HTMLElement)) return null;
    return {
      cardWidth: card.offsetWidth,
      edges: Array.from(document.querySelectorAll(".edge"), (edge) => edge.getAttribute("style")),
    };
  });
  if (before === null) throw new Error("top card not found");
  await page.reload();
  await expect(page.locator(".edge")).toHaveCount(5); // 6 notes → positions 2..6 → 5 edges
  const afterReload = await page.evaluate(() => {
    const card = document.querySelector(".card");
    if (!(card instanceof HTMLElement)) return null;
    return {
      cardWidth: card.offsetWidth,
      edges: Array.from(document.querySelectorAll(".edge"), (edge) => edge.getAttribute("style")),
    };
  });
  if (afterReload === null) throw new Error("top card not found after reload");
  expect(afterReload).toEqual(before);

  // -- Phase 9: long-name worst case @390 — the 80-char stack name ---------
  // Coverage for the long-name overflow guards (the Phase-4 tall-token
  // pass covered the note surfaces; this covers every NAME surface):
  // rename the active stack to an 80-char unbroken token via PATCH
  // /api/stacks/:id (T10 — the same route the drawer's rename uses), then
  // walk it through the desk chrome title, the list sheet header, an
  // archive chip, and the delete-confirm modal, with the scroll probes
  // clean at every stop. Leftovers stay inert (head comment): the modal is
  // cancelled, the stack is never renamed back, and the later
  // self-sufficient specs create their own active stacks and filter by
  // their own names / within-spec baselines.
  const renamed = await request.patch(`/api/stacks/${stackId}`, { data: { name: LONG_NAME } });
  expect(renamed.ok()).toBe(true);
  // (a) The desk chrome title: the WS re-render carries the long name with
  //     NO reload, and the desk still holds its width (the title column's
  //     overflow-wrap guard).
  await expect(page.locator(".title")).toContainText(LONG_NAME);
  await expectNoHorizontalScroll(page);
  // (b) The list sheet header ("${LONG_NAME} — 6 notes"): the h2 wrap
  //     guard — a sheet is position:fixed, so only the sheet's own probe
  //     can see its internal overflow (head comment).
  await page.getByRole("button", { name: `See all ${NOTE_COUNT + 1}` }).click();
  const listHeading = page.getByRole("heading", { name: `${LONG_NAME} — ${NOTE_COUNT + 1} notes` });
  await expect(listHeading).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(listHeading).toHaveCount(0);
  // (c) Done the tall top note through the UI (it is the 280-char token),
  //     revealing "Layout note 5" beneath; its completion snapshots the
  //     (now long) stack name into the archive entry. Scroll first, the
  //     Phase-4 way: with the tall card up, the pinned quick-add strip
  //     covers the action row's click point at scrollTop 0 — scrolling it
  //     clear is the honest mobile behavior.
  await page.evaluate(() => window.scrollBy(0, 96));
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".note-text")).toHaveText("Layout note 5");
  // (d) The archive chip: the completed entry's chip carries the long
  //     stack_name (denormalized at completion, T11) — found via the row's
  //     own tall text (the same row, guarded by the existing
  //     overflow-wrap:anywhere) with the chip filtered by the long name;
  //     the ellipsis guard keeps the ~480px name inside its entry.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  const longChip = page
    .getByRole("listitem")
    .filter({ hasText: TALL_TEXT })
    .locator(".chip")
    .filter({ hasText: LONG_NAME });
  await expect(longChip).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toHaveCount(0);
  // (e) The delete-confirm modal: the drawer row's kebab → Delete opens
  //     §5.4's confirm copy with the long name inside it. The modal's box
  //     (min(24rem, 100%) over the gutter-padded backdrop) must fit the
  //     390 walkthrough viewport — the thing this phase exists to prove
  //     for the 80-char name. It is asserted by its OWN bounding box,
  //     deliberately NOT by the scroll probes: the backdrop is
  //     position:fixed, so the modal is invisible to BOTH the document
  //     probe and the sheet probe (a fixed box's overflow never reaches
  //     either's scrollWidth — it is a viewport problem, so viewport
  //     bounds are the right assertion). The drawer SHEET probe around it
  //     stays valid and stays. Cancelled on purpose: deleting would also
  //     destroy the pending notes, and the leftover stack (renamed, never
  //     renamed back) is inert by design (head comment).
  await page.getByRole("button", { name: "Stacks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toBeVisible();
  await expectNoHorizontalScroll(page); // the drawer sheet itself
  await page.getByRole("button", { name: `Actions for ${LONG_NAME}` }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(`Delete '${LONG_NAME}'?`);
  const modalBox = await modal.boundingBox();
  if (modalBox === null) throw new Error("modal bounding box unavailable");
  expect(modalBox.x).toBeGreaterThanOrEqual(0);
  expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(PHONE.width);
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toHaveCount(0);
  // End on the bare desk, closing every opened surface (Phase 3's rule).
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toHaveCount(0);

  // End state (head comment): the leftover stack — renamed to the 80-char
  // token, 5 pending "Layout note N" notes, one long-named archive entry —
  // is inert for the later self-sufficient specs; nothing to clean up,
  // nothing to reset.
});
