/**
 * StackView mechanics e2e (T18; sources: TASKS.md T18 Done-when, DESIGN.md
 * §3/§5.1/§6, DECISIONS.md §4).
 *
 * ONE sequential test, deliberately: the specs share this run's DB
 * (web/playwright.config.ts), so phases build on each other —
 * fresh stack (created via API so this spec is self-sufficient and does not
 * depend on first-run.spec.ts having run first) → push → Done → edit → toss,
 * with server truth (`GET /api/state` through the same Vite proxy) asserted
 * after each mutation. Assertions are on durable/role-based locators
 * (getByRole / getByLabel, .title, .note-text), not Phase-2 placeholder
 * styling, so they survive the Phase-3 restyling (T23+).
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

test("push, Done, edit, and Toss behave like a stack", async ({ page, request }) => {
  // -- Phase 1: setup via API ----------------------------------------------
  // POST /api/stacks makes the new stack active (T10), so a fresh DB lands
  // directly on the Errands desk — no dependence on first-run.spec.ts.
  const created = await request.post("/api/stacks", { data: { name: "Errands" } });
  expect(created.ok()).toBe(true);
  await page.goto("/");

  const title = page.locator(".title");

  // -- Phase 2: empty desk — no card, no actions, quiet line ----------------
  await expect(title).toContainText("Errands");
  await expect(title).toContainText("0 notes");
  await expect(page.getByText("The stack is empty.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);

  // -- Phase 2b: T31 empty state — ghost outline at the pile's footprint,
  //    total stillness (DESIGN.md §5.1: bare desk, faint ghost outline
  //    where the stack was, one quiet line; §7: "empty stack: total
  //    stillness — nothing moves") -----------------------------------------
  const emptyState = page.locator(".empty-state");
  const ghost = page.locator(".empty-state .ghost");
  await expect(emptyState).toBeVisible();
  await expect(ghost).toBeVisible();
  // Decorative only: the outline is announced to nobody.
  expect(await ghost.getAttribute("aria-hidden")).toBe("true");
  // Outline, not a paper card: dashed 1px border, no background fill
  // (computed styles evaluated in Node, then asserted).
  const ghostStyle = await ghost.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      borderStyle: style.borderTopStyle,
      borderWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
    };
  });
  expect(ghostStyle.borderStyle).toBe("dashed");
  expect(ghostStyle.borderWidth).toBe("1px");
  expect(ghostStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(ghostStyle.backgroundImage).toBe("none");
  expect(ghostStyle.boxShadow).toBe("none");
  // Pile silhouette + horizontal centering at the default desktop viewport
  // (1280×720): the ghost occupies exactly where the pile was — 320×320
  // at this width (--pile-w/--pile-h; ±1px subpixel tolerance) — centered
  // in the stage.
  const desktop = await emptyState.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const stage = el.closest("main");
    const stageBox = stage?.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      centerX: box.left + box.width / 2,
      stageCenterX: stageBox ? stageBox.left + stageBox.width / 2 : null,
    };
  });
  expect(desktop.width).toBeGreaterThanOrEqual(319);
  expect(desktop.width).toBeLessThanOrEqual(321);
  expect(desktop.height).toBeGreaterThanOrEqual(319);
  expect(desktop.height).toBeLessThanOrEqual(321);
  expect(desktop.stageCenterX).not.toBeNull();
  expect(Math.abs(desktop.centerX - (desktop.stageCenterX ?? 0))).toBeLessThanOrEqual(1);
  // Total stillness: no Web Animations anywhere in the subtree, and the
  // computed animation/transition channels are inert on the wrapper, the
  // ghost, and the copy alike.
  const stillness = await emptyState.evaluate((el) => {
    const read = (node: Element) => {
      const style = getComputedStyle(node);
      return { animationName: style.animationName, transitionDuration: style.transitionDuration };
    };
    const nodes = [el, el.querySelector(".ghost"), el.querySelector(".empty")].filter(
      (node): node is Element => node !== null,
    );
    return { animations: el.getAnimations({ subtree: true }).length, styles: nodes.map(read) };
  });
  expect(stillness.animations).toBe(0);
  expect(stillness.styles).toHaveLength(3);
  for (const style of stillness.styles) {
    expect(style.animationName).toBe("none");
    expect(style.transitionDuration).toBe("0s");
  }
  // T31 depends on T28: at the ~390px mobile floor the ghost keeps the
  // responsive pile silhouette — width (100vw − 40)/1.13 ≈ 309.7px (>300,
  // ≤316) and the flat 320px height (tokens.css) — stays horizontally
  // centered, and the desk never opens a horizontal scroll.
  await page.setViewportSize({ width: 390, height: 720 });
  const mobile = await emptyState.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      centerX: box.left + box.width / 2,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(mobile.width).toBeGreaterThan(300);
  expect(mobile.width).toBeLessThanOrEqual(316);
  expect(mobile.height).toBeGreaterThanOrEqual(319);
  expect(mobile.height).toBeLessThanOrEqual(321);
  expect(Math.abs(mobile.centerX - 195)).toBeLessThanOrEqual(10);
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth);
  // Restore the default viewport so later phases are unchanged.
  await page.setViewportSize({ width: 1280, height: 720 });

  // -- Phase 3: push guard — whitespace disabled, text enabled --------------
  const input = page.getByLabel("New note");
  const push = page.getByRole("button", { name: "Push" });
  await expect(push).toBeDisabled(); // empty
  await input.fill("   ");
  await expect(push).toBeDisabled();
  await input.fill("Fix the leaky faucet");
  await expect(push).toBeEnabled();

  // -- Phase 4: push via button → top note + cleared input ------------------
  await push.click();
  await expect(page.locator(".note-text")).toHaveText("Fix the leaky faucet");
  await expect(title).toContainText("1 note");
  await expect(input).toHaveValue("");

  // -- Phase 5: push via Enter (native form submit) → becomes new top -------
  await input.fill("Order a ladder");
  await input.press("Enter");
  await expect(page.locator(".note-text")).toHaveText("Order a ladder");
  await expect(title).toContainText("2 notes");
  // Server truth: FILO — the ladder note sits ON TOP of the faucet note.
  const afterPush = await stateOf(request);
  const errands = afterPush.stacks.find((stack) => stack.name === "Errands");
  expect(errands).toBeDefined();
  const pending = afterPush.notes
    .filter((note) => note.stackId === errands?.id)
    .sort((a, b) => a.position - b.position);
  expect(pending.map((note) => note.text)).toEqual(["Order a ladder", "Fix the leaky faucet"]);

  // -- Phase 6: "See all 2" opens the LIST sheet; Close returns to the desk -
  await page.getByRole("button", { name: "See all 2" }).click();
  const close = page.getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();
  // Prove it is the LIST sheet, not just any overlay: the durable header
  // renders "<stack> — <count>" (ListView, DESIGN.md §5.3).
  const sheetHeading = page.getByRole("heading", { name: "Errands — 2 notes" });
  await expect(sheetHeading).toBeVisible();
  await close.click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

  // -- Phase 7: Esc in quick-add clears the draft, desk unaffected ----------
  await input.fill("half a thought");
  await input.press("Escape"); // input-internal: consumed, never an overlay
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

  // -- Phase 8: Done pops the top → next note is top, archive entry exists --
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".note-text")).toHaveText("Fix the leaky faucet");
  await expect(title).toContainText("1 note");
  const afterDone = await stateOf(request);
  const ladderDone = afterDone.completed.find((entry) => entry.text === "Order a ladder");
  expect(ladderDone).toBeDefined();
  expect(ladderDone?.stackName).toBe("Errands"); // snapshotted at completion
  expect(afterDone.notes.some((note) => note.text === "Order a ladder")).toBe(false); // no longer pending
  // Relative baseline: Toss later must add NOTHING and take NOTHING
  // (DECISIONS.md §4: no archive credit, no archive guilt).
  const completedCount = afterDone.completed.length;

  // -- Phase 9: Edit save (same id, still position 1) ------------------------
  await page.getByRole("button", { name: "Edit" }).click();
  const noteText = page.getByLabel("Note text");
  await expect(noteText).toHaveValue("Fix the leaky faucet");
  await noteText.fill("   ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await noteText.fill("Fix the leaky faucet — new gasket");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".note-text")).toHaveText("Fix the leaky faucet — new gasket");
  const afterEdit = await stateOf(request);
  const edited = afterEdit.notes.find((note) => note.id === pending[1]?.id);
  expect(edited).toBeDefined();
  expect(edited?.text).toBe("Fix the leaky faucet — new gasket");
  expect(edited?.position).toBe(1);
  expect(afterEdit.notes.filter((note) => note.stackId === errands?.id)).toHaveLength(1);

  // -- Phase 10: Edit cancel (Cancel button) — draft discarded, text intact -
  await page.getByRole("button", { name: "Edit" }).click();
  await noteText.fill("garbage");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".note-text")).toHaveText("Fix the leaky faucet — new gasket");

  // -- Phase 11: Edit cancel (Esc) — same outcome, edit form gone -----------
  await page.getByRole("button", { name: "Edit" }).click();
  await noteText.fill("garbage again");
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-text")).toHaveText("Fix the leaky faucet — new gasket");
  await expect(page.getByLabel("Note text")).toHaveCount(0);

  // -- Phase 12: Toss removes quietly — no archive credit (DECISIONS §4) -----
  await page.getByRole("button", { name: "Toss" }).click();
  await expect(page.getByText("The stack is empty.")).toBeVisible();
  await expect(page.locator(".note-text")).toHaveCount(0);
  await expect(title).toContainText("0 notes");
  const afterToss = await stateOf(request);
  expect(afterToss.notes.filter((note) => note.stackId === errands?.id)).toHaveLength(0);
  // Same archive size as after the Done phase: toss adds nothing AND takes
  // nothing — completed rows are immutable by toss (DECISIONS.md §4).
  expect(afterToss.completed).toHaveLength(completedCount);
  expect(
    afterToss.completed.some((entry) => entry.text === "Fix the leaky faucet — new gasket"),
  ).toBe(false);
});
