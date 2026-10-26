/**
 * First Run e2e (T17; sources: TASKS.md T17 Done-when, DESIGN.md §5.5).
 *
 * ONE sequential test, deliberately: the specs share this run's DB
 * (web/playwright.config.ts), so phases build on each other —
 * fresh first-run server → create "Work" → StackView from server truth.
 * Assertions are on durable chrome and accessible roles (getByRole /
 * getByLabel), not Phase-2 placeholder text, so they survive the Phase-3
 * restyling (T23+).
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * Mirrors the view-machine truth (T16): First Run shows exactly when there
 * are no stacks; StackView chrome (Archive button is known to exist in §5.5
 * era and beyond, unlike the "arrives with T18" placeholder) shows after.
 */
async function expectFirstRun(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "What's this stack for?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create stack" })).toBeVisible();
}

async function expectStackView(page: Page, stackName: string): Promise<void> {
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  // Active-stack name is real chrome (StackView .title), not placeholder.
  await expect(page.locator(".title")).toContainText(stackName);
  await expect(page.locator(".title")).toContainText("0 notes");
  // The first-run screen must actually be gone, not merely beside the desk.
  await expect(page.getByRole("heading", { name: "What's this stack for?" })).toHaveCount(0);
}

test("fresh DB creates the first stack and lands on StackView", async ({ page, request }) => {
  // -- Phase 1: fresh server → First Run form -----------------------------
  // A non-fresh DB would render StackView and fail here loudly.
  await page.goto("/");
  await expectFirstRun(page);

  const input = page.getByLabel("Stack name");

  // -- Phase 2: submit guards — empty/whitespace disabled, text enabled ----
  const create = page.getByRole("button", { name: "Create stack" });
  await expect(create).toBeDisabled();
  await input.fill("   ");
  await expect(create).toBeDisabled();
  await input.fill("Work");
  await expect(create).toBeEnabled();

  // -- Phase 3: submit → view machine flips to StackView (server truth) ---
  await create.click();
  await expectStackView(page, "Work");

  // -- Phase 4: server truth — exactly one active stack, same proxy path --
  const state = await request.get("/api/state");
  expect(state.ok()).toBe(true);
  const body = (await state.json()) as {
    activeStackId: unknown;
    stacks: Array<{ id: string; name: string }>;
  };
  expect(body.stacks).toHaveLength(1);
  expect(body.stacks[0]?.name).toBe("Work");
  expect(body.activeStackId).toBe(body.stacks[0]?.id);
});
