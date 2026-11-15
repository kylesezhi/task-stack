/**
 * Keyboard-only walkthrough + axe scan e2e (T33 microcopy/accessibility pass;
 * sources: TASKS.md T33, DESIGN.md §3/§6, DECISIONS.md §4).
 *
 * WHY THE `zz-` PREFIX: all e2e specs share this run's ONE SQLite DB and run
 * alphabetically with a single worker (web/playwright.config.ts). This spec
 * DELETES every stack to reach the First Run screen, so it must run LAST —
 * the `zz-` prefix guarantees it sorts after every other spec file and can
 * never tear the DB out from under them.
 *
 * KEYBOARD-ONLY: every UI action here is driven by `page.keyboard.*` (Tab /
 * Shift+Tab, Enter, Escape, "/", arrows, typing) — no `.click()`, `.focus()`,
 * `.hover()`, or `page.mouse.*` on UI elements. Only API setup/teardown goes
 * through the `request` fixture. Tab counts are never hard-coded beyond the
 * walkthrough plan: `tabUntilFocused` presses until the target actually holds
 * focus, so a benign tab-order change cannot desync the walkthrough.
 *
 * AXE: `scan(page, label)` runs axe-core on the current page and hard-asserts
 * that ZERO critical and ZERO serious violations exist. A failure here is a
 * finding to adjudicate, never something to scope away with rule exclusions.
 *
 * ONE sequential test, deliberately (suite rule: this run's ONE DB, files
 * alphabetical, workers 1). Phases build on one another: First Run → create
 * "Accessible" → push three notes → pop → edit → REORDER (list sheet) → toss
 * → stacks drawer + second stack → delete-confirm modal → archive → the
 * title's preserved paragraph weight.
 *
 * DEVIATION FROM THE WALKTHROUGH PLAN (toss ⇄ reorder swapped): the plan put
 * the Toss phase (leaving ONE note) before the reorder phase, but its reorder
 * assertions expect a TWO-note stack (["Alpha", "Beta edited"], "Moved to
 * position 2 of 2.") — unreachable after a toss deletes "Beta edited" (toss
 * is a hard DELETE, server/src/notes.ts). The two phases are swapped so both
 * behaviors stay fully covered: the reorder dance runs on the 2-note pile
 * (See all 2), then the keyboard toss runs (leaving "1 note"). Every expected
 * value from the plan is asserted; only the phase order and the "See all N"
 * label inside the sheet phase differ.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** Pending notes of the named stack, position-ascending (server truth). */
function pendingOf(state: AppState, stackId: string): AppState["notes"] {
  return state.notes
    .filter((note) => note.stackId === stackId)
    .sort((a, b) => a.position - b.position);
}

/** Top-first texts of the sheet's rows, in DOM order (the note-text span per
 * row — the same durable class stack-view.spec.ts relies on). Scope: only the
 * sheet's rows are listitems, so this never reads the desk card beneath. */
async function rowTexts(page: Page): Promise<string[]> {
  return page.getByRole("listitem").locator(".note-text").allTextContents();
}

/**
 * Presses Tab (or Shift+Tab) until `target` is document.activeElement; if it
 * never gets there, the trailing toBeFocused fails loudly with Playwright's
 * own "element is not focused" report instead of a silent walkthrough drift.
 * `target` must be a single-element locator (use .first() when needed).
 */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  { direction = "Tab", max = 15 }: { direction?: "Tab" | "Shift+Tab"; max?: number } = {},
): Promise<void> {
  for (let presses = 0; presses < max; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press(direction);
  }
  await expect(target).toBeFocused();
}

/** One axe finding as a readable "id (impact): help" token. */
function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  return violations.map((v) => `${v.id} (${v.impact ?? "unknown"}): ${v.help}`).join("; ");
}

/**
 * axe-core over the whole page: critical and serious violations are hard
 * failures with the full finding list in the assertion message. Moderate and
 * below are out of scope for this pass (reported upstream if they appear, but
 * never asserted here).
 *
 * Before analyzing, every running animation/transition is awaited to
 * completion: the sheets fade their scrim in over 160ms, and axe reads
 * COMPUTED colors — a scan that starts mid-fade composites the translucent
 * overlay into the elements' foregrounds/backgrounds and reports phantom
 * contrast failures with blended colors that exist in no stylesheet. The
 * two rAFs register the intro transitions first (Svelte creates them a
 * frame after mount — a bare getAnimations() can still come back empty),
 * and the scrim's own opacity gate cannot pass mid-fade (opacity is
 * exactly "1" only on the final frame). The app has no infinite animations
 * (verified: web/src has none), so `finished` always resolves and the
 * settle cannot hang.
 */
async function scan(page: Page, label: string): Promise<void> {
  // Register the intro transitions first (Svelte creates them a frame after
  // mount), then gate on the scrim's fade actually finishing: opacity is
  // exactly "1" only on the final frame, so this cannot pass mid-fade.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  if ((await page.locator(".overlay").count()) > 0) {
    await expect(page.locator(".overlay").first()).toHaveCSS("opacity", "1");
  }
  await page.evaluate(() =>
    // document.getAnimations() already spans the WHOLE document (the
    // subtree option exists only on Element.getAnimations) — every
    // animation here is awaited to completion.
    Promise.all(
      document.getAnimations().map((a) =>
        a.finished.then(
          () => undefined,
          () => undefined,
        ),
      ),
    ),
  );
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");
  expect(critical, `critical a11y violations in ${label}: ${describeViolations(critical)}`).toEqual(
    [],
  );
  expect(serious, `serious a11y violations in ${label}: ${describeViolations(serious)}`).toEqual(
    [],
  );
}

test("a keyboard-only user can run the whole app and axe finds no critical or serious violations", async ({
  page,
  request,
}) => {
  const title = page.locator(".title");
  const noteText = page.locator(".note-text");
  const status = page.locator('[role="status"]'); // the one global live region

  // -- Phase 1: reset to First Run via API (this spec runs LAST, so it may
  //    tear the shared DB down) ------------------------------------------
  const before = await stateOf(request);
  for (const stack of before.stacks) {
    const deleted = await request.delete(`/api/stacks/${stack.id}`);
    expect(deleted.ok()).toBe(true);
  }
  expect((await stateOf(request)).stacks).toHaveLength(0);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What's this stack for?" })).toBeVisible();
  await scan(page, "first run");

  // -- Phase 2: keyboard-only create (Tab → #stack-name, type, Enter) -----
  await page.keyboard.press("Tab");
  const nameInput = page.locator("#stack-name");
  await expect(nameInput).toBeFocused();
  await page.keyboard.type("Accessible");
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Accessible");
  await expect(title).toContainText("0 notes");
  // Server truth: keep the stack id for the reorder assertions later.
  const created = await stateOf(request);
  const stackId = created.activeStackId;
  if (stackId === null) throw new Error("no active stack after creating Accessible");
  await scan(page, "empty stack view");

  // -- Phase 3: push three notes keyboard-only ("/" → quick-add) ----------
  await page.keyboard.press("/");
  const quickAdd = page.locator("#quick-add");
  await expect(quickAdd).toBeFocused();
  // Esc with a draft clears it (input-internal Esc is consumed on the
  // input — App's window handler never fires, the sheet-less desk stays).
  await page.keyboard.type("scratch");
  await page.keyboard.press("Escape");
  await expect(quickAdd).toHaveValue("");
  for (const text of ["Alpha", "Beta", "Gamma"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    // Two gates before the next type: the card shows the pushed note (the
    // WS snapshot can land first), and the draft is EMPTY — the draft only
    // clears when the push's own round-trip resolves, so an Enter pressed
    // earlier is a silent no-op and typing would weld the texts together
    // (stack-view.spec.ts's toHaveValue("") pattern).
    await expect(noteText).toHaveText(text);
    await expect(quickAdd).toHaveValue("");
    // The push changed the top id — the global live region narrates it.
    if (text === "Alpha") {
      await expect(status).toHaveText("Alpha — top of Accessible, 1 note.");
    }
  }
  await expect(title).toContainText("3 notes");
  await scan(page, "stack view with notes");

  // -- Phase 4: pop (Done) — Shift+Tab back up the desk to the row --------
  const done = page.getByRole("button", { name: "Done", exact: true });
  await tabUntilFocused(page, done, { direction: "Shift+Tab" });
  await page.keyboard.press("Enter");
  await expect(noteText).toHaveText("Beta"); // Gamma burned, Beta revealed
  // The pop changed the top id (Gamma → Beta) — narrated too.
  await expect(status).toHaveText("Beta — top of Accessible, 2 notes.");
  // The ceremony rests the row (T29); wait it out before acting again.
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();

  // -- Phase 5: edit — Tab reaches Edit; the form mounts focused ----------
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const noteInput = page.locator("#note-text");
  await expect(noteInput).toBeFocused();
  // The input mounts with the draft and an end-of-text caret (no select on
  // focus), so typing appends.
  await page.keyboard.type(" edited");
  await page.keyboard.press("Enter");
  await expect(noteText).toHaveText("Beta edited");

  // -- Phase 6: keyboard reorder in the list sheet (2-note pile) ----------
  // DEVIATION: this phase runs BEFORE the toss (see the head comment) —
  // the plan's reorder assertions need Alpha AND "Beta edited" both pending.
  const seeAll = page.getByRole("button", { name: "See all 2" });
  await tabUntilFocused(page, seeAll); // the edit restored focus to the Edit button
  await page.keyboard.press("Enter");
  const sheet = page.locator(".sheet");
  await expect(sheet).toHaveAttribute("role", "dialog");
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(sheet).toBeFocused(); // dialogFocus pins the container
  await scan(page, "list sheet");

  // The top row's handle (top-first rows; re-focuses itself after each
  // commit because it held focus before the move).
  const firstHandle = sheet.getByRole("button", { name: "Drag to reorder" }).first();
  await tabUntilFocused(page, firstHandle);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => rowTexts(page)).toEqual(["Alpha", "Beta edited"]);
  // The clear window is only 1s — pin the live-region copy before the
  // stateOf() round-trips eat into it.
  await expect(status).toHaveText("Moved to position 2 of 2.");
  const afterDown = await stateOf(request);
  expect(pendingOf(afterDown, stackId).map((note) => note.text)).toEqual(["Alpha", "Beta edited"]);

  await page.keyboard.press("ArrowUp");
  await expect.poll(() => rowTexts(page)).toEqual(["Beta edited", "Alpha"]);
  await expect(status).toHaveText("Moved to position 1 of 2.");
  const afterUp = await stateOf(request);
  expect(pendingOf(afterUp, stackId).map((note) => note.text)).toEqual(["Beta edited", "Alpha"]);

  await page.keyboard.press("ArrowUp"); // boundary press
  await expect(status).toHaveText("Already at the top.");

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(seeAll).toBeFocused(); // dialogFocus returns it to the trigger

  // -- Phase 7: toss (keyboard) — the quiet delete leaves "1 note" --------
  const toss = page.getByRole("button", { name: "Toss", exact: true });
  await tabUntilFocused(page, toss);
  await page.keyboard.press("Enter");
  await expect(noteText).toHaveText("Alpha");
  await expect(title).toContainText("1 note");
  // The toss changed the top id ("Beta edited" → Alpha) — narrated.
  await expect(status).toHaveText("Alpha — top of Accessible, 1 note.");

  // -- Phase 8: switch stacks via the drawer (dialog semantics) -----------
  const stacksButton = page.getByRole("button", { name: "Stacks", exact: true });
  await tabUntilFocused(page, stacksButton);
  await page.keyboard.press("Enter");
  const drawer = page.locator(".sheet--drawer");
  await expect(drawer).toHaveAttribute("role", "dialog");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(drawer).toBeFocused();
  await scan(page, "stacks drawer");

  // Keyboard-create the second stack; the drawer stays open.
  const drawerInput = page.locator("#drawer-stack-name");
  await tabUntilFocused(page, drawerInput);
  await page.keyboard.type("Second");
  await page.keyboard.press("Enter");
  // Gate on the create landing BEFORE switching: if the snapshot were still
  // in flight, onSwitch would see Accessible as already active, early-return,
  // and the title assertion below would pass vacuously. Also pins the new
  // stack's empty announcement.
  await expect(page.getByRole("button", { name: /^Second \(0\)/ })).toBeVisible();
  await expect(status).toHaveText("Second is empty.");
  // Switch back: the drawer keeps rows in server order (Accessible first),
  // and the row's switch button name starts with the stack name.
  const accessibleButton = page.getByRole("button", { name: /^Accessible/ }).first();
  await tabUntilFocused(page, accessibleButton);
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Accessible"); // desk beneath the open drawer
  // The switch changed the top id (Second's top → Accessible's Alpha) —
  // narrated, even with the drawer still open (the live region sits
  // outside the inert desk wrapper).
  await expect(status).toHaveText("Alpha — top of Accessible, 1 note.");

  // -- Phase 9: delete-confirm modal (focus trap + inert sheet) -----------
  const secondKebab = page.getByRole("button", { name: "Actions for Second" });
  await tabUntilFocused(page, secondKebab);
  await page.keyboard.press("Enter"); // menu seeds focus on its first item
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  // The modal is the dialog INSIDE the backdrop (the drawer sheet is a
  // dialog too, but it goes inert behind this one).
  const modal = page.locator(".backdrop").getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(drawer).toHaveAttribute("inert", "");
  await scan(page, "delete confirm modal");

  // Two Tabs prove the trap: Cancel → Delete → Cancel (nothing else).
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape"); // cancels ONLY the modal
  await expect(modal).toHaveCount(0);
  await expect(secondKebab).toBeFocused(); // focus returns to the kebab
  await page.keyboard.press("Escape"); // now the drawer itself closes
  await expect(drawer).toHaveCount(0);
  await expect(stacksButton).toBeFocused();

  // -- Phase 10: archive sheet (dialog semantics + Esc return) ------------
  const archiveButton = page.getByRole("button", { name: "Archive", exact: true });
  await tabUntilFocused(page, archiveButton);
  await page.keyboard.press("Enter");
  const archiveSheet = page.locator(".sheet"); // no other sheet is open here
  await expect(archiveSheet).toHaveAttribute("role", "dialog");
  await expect(archiveSheet).toBeFocused();
  await scan(page, "archive sheet");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Archive" })).toHaveCount(0);
  await expect(archiveButton).toBeFocused();

  // -- Phase 11: the title kept the old paragraph's weight (T33 h1 swap) --
  expect(await title.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
});
