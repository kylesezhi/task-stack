/**
 * Happy path e2e (T22; sources: TASKS.md T22 Done-when, App.svelte's
 * svelte:window comment). The distinguishing feature vs the other specs:
 * every state change here — create the stack, push, push, Done — is driven
 * THROUGH THE UI, never seeded via the API; the API is used only for the
 * loud Phase-1 reset and the server-truth reads.
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and spec files execute alphabetically — this
 * file sorts between first-run.spec.ts ("h" after "f") and list-view.spec.ts,
 * so phases build on each other and nothing inside may run in parallel.
 *
 * Phase-1 reset rationale: the run's DB starts fresh only once, and by the
 * time this file runs it holds earlier specs' leftovers — first-run.spec.ts
 * leaves stack "Work" behind, and completed entries persist by design
 * (DECISIONS.md §6: deleting a stack keeps its completed rows), so the true
 * precondition for the First Run screen (ZERO stacks) must be re-created
 * here, loudly: delete every stack the run produced, then assert
 * `stacks === []` and `activeStackId === null`. Never assert the identity of
 * the leftovers (coupling to "Work" would break on any earlier re-order).
 * Because those completed entries survive the reset, the archive phase
 * asserts MEMBERSHIP (B is an entry with stackName "Home") and derives the
 * header count from server truth — never a hardcoded global completed count,
 * and never the archive's empty state ("Nothing done yet…" cannot show here).
 *
 * Suite citizenship: the later specs (list-view, stack-view, stacks-drawer)
 * are self-sufficient — they create their own stacks via the API and assert
 * only their own uniquely-named rows — so this spec's leftovers (a "Home"
 * stack with one pending note and one completed entry) harm no one.
 *
 * Server truth (`GET /api/state` through the same Vite proxy) is asserted
 * after each mutation. Durable/role-based locators only (getByRole /
 * getByLabel, .title / .note-text / .chip / section.day — the same
 * durable-class precedent as the other specs), no testids, no Phase-2
 * styling. Same accepted midnight-crossing edge as archive-view.spec.ts: a
 * run spanning local midnight could relabel B's entry out of "Today".
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** The day-group section whose h3 reads exactly `label` (copy of
 * archive-view.spec.ts's helper — per harness convention helpers are
 * copy-pasted per spec file, no shared fixture module). */
function daySection(page: Page, label: string) {
  return page.locator("section.day", {
    has: page.getByRole("heading", { name: label, exact: true }),
  });
}

test("the happy path through the UI: create, push, push, Done, archive, Esc", async ({
  page,
  request,
}) => {
  // -- Phase 1: loud reset to the zero-stacks precondition (head comment) ---
  const initial = await stateOf(request);
  for (const stack of initial.stacks) {
    const removed = await request.delete(`/api/stacks/${stack.id}`);
    expect(removed.status()).toBe(200);
  }
  const reset = await stateOf(request);
  expect(reset.stacks).toEqual([]);
  expect(reset.activeStackId).toBeNull();

  // -- Phase 2: zero stacks → the first-run form ----------------------------
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What's this stack for?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create stack" })).toBeVisible();

  // -- Phase 3: create "Home" through the form → StackView ------------------
  await page.getByLabel("Stack name").fill("Home");
  await page.getByRole("button", { name: "Create stack" }).click();
  const title = page.locator(".title");
  await expect(title).toContainText("Home");
  await expect(title).toContainText("0 notes");
  await expect(page.getByText("The stack is empty.")).toBeVisible();
  // The first-run screen must actually be gone, not merely beside the desk.
  await expect(page.getByRole("heading", { name: "What's this stack for?" })).toHaveCount(0);
  // Server truth — global count is safe: Phase 1 zeroed the stacks.
  const afterCreate = await stateOf(request);
  expect(afterCreate.stacks).toHaveLength(1);
  expect(afterCreate.stacks[0]?.name).toBe("Home");
  expect(afterCreate.activeStackId).toBe(afterCreate.stacks[0]?.id);
  const homeId = afterCreate.stacks[0]?.id;
  if (homeId === undefined) throw new Error("no stack after creating Home");

  // -- Phase 4: push note A via the Push button ------------------------------
  const NOTE_A = "Defrost the bread dough";
  const input = page.getByLabel("New note");
  await input.fill(NOTE_A);
  await page.getByRole("button", { name: "Push" }).click();
  await expect(page.locator(".note-text")).toHaveText(NOTE_A);
  await expect(title).toContainText("1 note");
  await expect(input).toHaveValue("");

  // -- Phase 5: push note B via Enter (native form submit) → new top ---------
  const NOTE_B = "Text the landlord";
  await input.fill(NOTE_B);
  await input.press("Enter");
  await expect(page.locator(".note-text")).toHaveText(NOTE_B);
  await expect(title).toContainText("2 notes");
  // Server truth: FILO — B sits on top of A.
  const afterPush = await stateOf(request);
  const pending = afterPush.notes
    .filter((note) => note.stackId === homeId)
    .sort((a, b) => a.position - b.position);
  expect(pending.map((note) => note.text)).toEqual([NOTE_B, NOTE_A]);

  // -- Phase 6: Done pops B → A is top; B is an archive entry ----------------
  // Completed MEMBERSHIP only (find by text): the archive-view.spec.ts
  // leftovers persist by design, so a hardcoded global completed count would
  // be wrong here.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".note-text")).toHaveText(NOTE_A);
  await expect(title).toContainText("1 note");
  const afterDone = await stateOf(request);
  expect(
    afterDone.notes.filter((note) => note.stackId === homeId).map((note) => note.text),
  ).toEqual([NOTE_A]);
  const doneB = afterDone.completed.find((entry) => entry.text === NOTE_B);
  expect(doneB).toBeDefined();
  expect(doneB?.stackName).toBe("Home"); // snapshotted at completion

  // -- Phase 7: archive → header count from server truth, B under "Today" ----
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  // The header count is DERIVED from server truth, never hardcoded: this
  // run's completed list holds leftovers from archive-view.spec.ts too.
  const archiveState = await stateOf(request);
  await expect(page.getByText(`${archiveState.completed.length} done`)).toBeVisible();
  const entryB = daySection(page, "Today").locator(".entry").filter({ hasText: NOTE_B });
  await expect(entryB).toHaveCount(1);
  await expect(entryB.locator(".chip")).toHaveText("Home");

  // -- Phase 8: window-level Esc closes the sheet (the T22 binding) ----------
  // Focus is still on the Archive button — no input holds focus, nothing
  // stopPropagation-consumes the key (unlike every Esc press in the other
  // specs, which happens inside an input). This keypress therefore reaches
  // App.svelte's svelte:window keydown → closeOverlay() binding, which per
  // App.svelte's own comment T22's e2e is the approved place to exercise.
  await page.keyboard.press("Escape");
  // Sheet-gone first, then the desk beneath (list-view.spec.ts precedent):
  // StackView passes visible checks even if the overlay never closed.
  await expect(page.getByRole("heading", { name: "Archive" })).toHaveCount(0);
  await expect(title).toContainText("Home");
  await expect(page.locator(".note-text")).toHaveText(NOTE_A);
});
