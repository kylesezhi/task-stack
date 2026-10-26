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
