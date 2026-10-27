/**
 * StacksDrawer mechanics e2e (T20; sources: TASKS.md T20 Done-when,
 * DESIGN.md §5.4, DECISIONS.md §4).
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts, spec files run alphabetically AFTER
 * first-run/list-view/stack-view), so this spec is SELF-SUFFICIENT of the
 * leftovers: it creates its own uniquely-named stacks ("Reading", "Letters",
 * "Projects") via the API and asserts only on those rows — presence of
 * other (leftover) rows is never asserted away. Server truth
 * (`GET /api/state` through the same Vite proxy) is asserted after each
 * mutation. Assertions are on durable/role-based locators (getByRole /
 * getByLabel, container-filtered rows, .title / .stack-button — the same
 * durable-class precedent as stack-view.spec.ts's .title and
 * list-view.spec.ts's .note-text), no testids, no Phase-2 styling.
 *
 * The Done-when's WS phase opens a SECOND browser context (pageB) and
 * asserts the active-stack switch lands there without a reload — the WS
 * broadcast, not a poll of the HTTP response, must drive the other client.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** The drawer row of the named stack (name is unique by construction). */
function rowOf(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

test("the drawer creates, renames, deletes, and switches stacks", async ({
  page,
  request,
  browser,
}) => {
  // -- Phase 1: setup via API — Reading, then Letters (3 notes, 1 done) ----
  // POST /api/stacks creates AND makes active (T10), so creating Reading
  // first and Letters second leaves Letters active. Each reply is the fresh
  // AppState (server truth).
  const readingRes = await request.post("/api/stacks", { data: { name: "Reading" } });
  expect(readingRes.ok()).toBe(true);
  const afterReading = (await readingRes.json()) as AppState;
  const readingId = afterReading.activeStackId;
  if (readingId === null) throw new Error("no active stack after POST /api/stacks");
  const lettersRes = await request.post("/api/stacks", { data: { name: "Letters" } });
  expect(lettersRes.ok()).toBe(true);
  const afterLetters = (await lettersRes.json()) as AppState;
  const lettersId = afterLetters.activeStackId;
  if (lettersId === null) throw new Error("no active stack after POST /api/stacks");
  // Pushed onto Letters; pushed top-first, DOM order is reversed server-side
  // but this spec never asserts pending order — only counts/membership.
  for (const text of ["Buy stamps", "Mail the parcel", "Call the bank"]) {
    const pushed = await request.post(`/api/stacks/${lettersId}/notes`, { data: { text } });
    expect(pushed.ok()).toBe(true);
  }
  const afterPush = await stateOf(request);
  // Complete by id (by-id is fine — top-only is a client concern): the
  // "Call the bank" note becomes an Archive entry, Letters keeps 2 pending.
  const bankNote = afterPush.notes.find((note) => note.text === "Call the bank");
  expect(bankNote).toBeDefined();
  const completedRes = await request.post(`/api/notes/${bankNote?.id}/complete`);
  expect(completedRes.ok()).toBe(true);

  await page.goto("/");

  // -- Phase 2: open the drawer; rows read name, count, active marker ------
  await page.getByRole("button", { name: "Stacks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toBeVisible();
  await expect(rowOf(page, "Letters")).toContainText("(2)");
  await expect(rowOf(page, "Letters")).toContainText("— active");
  await expect(rowOf(page, "Reading")).toContainText("(0)");

  // -- Phase 3: create "Projects" — whitespace guard, then active at end ---
  const createInput = page.getByLabel("Stack name");
  const createButton = page.getByRole("button", { name: "+ New stack" });
  await expect(createButton).toBeDisabled(); // empty
  await createInput.fill("   ");
  await expect(createButton).toBeDisabled(); // whitespace
  await createInput.fill("Projects");
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(rowOf(page, "Projects")).toContainText("(0)");
  await expect(rowOf(page, "Projects")).toContainText("— active");
  // Server truth: the new stack is ACTIVE and sits at the drawer end.
  const afterCreate = await stateOf(request);
  const projects = afterCreate.stacks.find((stack) => stack.name === "Projects");
  expect(projects).toBeDefined();
  expect(afterCreate.activeStackId).toBe(projects?.id);
  expect(afterCreate.stacks.at(-1)?.id).toBe(projects?.id);
  await expect(createInput).toHaveValue(""); // draft cleared (nothing typed ahead)

  // -- Phase 4: rename via the kebab — prefill, guard, save, two cancels ---
  const readingRow = rowOf(page, "Reading");
  await readingRow.getByRole("button", { name: "Actions for Reading" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const renameInput = page.getByLabel("Rename stack");
  await expect(renameInput).toHaveValue("Reading");
  await renameInput.fill("   ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await renameInput.fill("Reading pile");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(rowOf(page, "Reading pile")).toContainText("(0)");
  const afterRename = await stateOf(request);
  expect(afterRename.stacks.find((stack) => stack.id === readingId)?.name).toBe("Reading pile");
  // Rename must not reorder the drawer nor change the active stack.
  expect(afterRename.stacks.map((stack) => stack.id)).toEqual(
    afterCreate.stacks.map((stack) => stack.id),
  );
  expect(afterRename.activeStackId).toBe(projects?.id);

  // Cancel path 1: the Cancel button discards the draft, text untouched.
  const pileRow = rowOf(page, "Reading pile");
  await pileRow.getByRole("button", { name: "Actions for Reading pile" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Rename stack").fill("garbage");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Rename stack")).toHaveCount(0);
  await expect(rowOf(page, "Reading pile")).toContainText("(0)");

  // Cancel path 2: Esc ON THE RENAME INPUT cancels the rename AND is
  // consumed — the sheet stays open (the layering assertion: App.svelte's
  // window Esc must not close the drawer for the same keypress).
  await pileRow.getByRole("button", { name: "Actions for Reading pile" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Rename stack").fill("garbage again");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Rename stack")).toHaveCount(0); // edit gone
  await expect(page.getByRole("heading", { name: "Stacks" })).toBeVisible(); // sheet STILL open

  // -- Phase 5: switch active — and WS lands it in a second context ---------
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto("/");
  // B's desk starts on the CURRENT server-active stack — Projects, created
  // (and made active by server truth) in Phase 3 — and it is the switch to
  // Reading pile that THE SECOND CLIENT must later see land via WS (the
  // literal T20 Done-when).
  await expect(pageB.locator(".title")).toContainText("Projects");
  const beforeSwitch = await stateOf(request);
  const pileId = readingId;
  expect(beforeSwitch.activeStackId).toBe(projects?.id);

  await page.locator(".stack-button").filter({ hasText: "Reading pile" }).click();
  await expect(rowOf(page, "Reading pile")).toContainText("— active"); // marker moved
  const afterSwitch = await stateOf(request);
  expect(afterSwitch.activeStackId).toBe(pileId);
  // The WS broadcast lands in context B WITHOUT any reload.
  await expect(pageB.locator(".title")).toContainText("Reading pile");
  expect(beforeSwitch.stacks.length).toBe(afterSwitch.stacks.length); // switch creates nothing

  // -- Phase 6: delete a NON-ACTIVE stack (Letters) — confirm modal + copy --
  const lettersRow = rowOf(page, "Letters");
  await lettersRow.getByRole("button", { name: "Actions for Letters" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click(); // kebab menu item
  // §5.4's copy, verbatim — 2 pending notes, completed one survives.
  await expect(
    page.getByText(
      "Delete 'Letters'? Its 2 notes go with it. Completed notes stay in the Archive.",
    ),
  ).toBeVisible();

  // Cancel keeps the row and closes the modal.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(lettersRow).toContainText("(2)");

  // Esc path (capture-phase regression guard): re-open the modal and press
  // Esc with focus on <body> — clicking a menu item unmounts its focused
  // button, so this keypress targets body and can never pass through the
  // drawer's DOM. It must still only cancel the MODAL (window-capture
  // listener in the drawer consumes it), and the SHEET must stay open —
  // before the fix, App.svelte's window Esc closed the whole drawer here.
  await lettersRow.getByRole("button", { name: "Actions for Letters" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  // The modal must actually be open before the Esc below — otherwise an
  // open kebab menu's capture listener would consume it and all three
  // assertions after it would pass vacuously.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0); // modal cancelled
  await expect(page.getByRole("heading", { name: "Stacks" })).toBeVisible(); // sheet STILL open
  await expect(lettersRow).toContainText("(2)"); // nothing deleted

  // Re-open and confirm: row gone via snapshot, pending notes die, the
  // completed entry survives with stackId → null and the kept stackName.
  await lettersRow.getByRole("button", { name: "Actions for Letters" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(lettersRow).toHaveCount(0); // row gone
  const afterDeleteLetters = await stateOf(request);
  expect(afterDeleteLetters.notes.some((note) => note.stackId === lettersId)).toBe(false);
  const bankArchive = afterDeleteLetters.completed.find((entry) => entry.text === "Call the bank");
  expect(bankArchive).toBeDefined();
  expect(bankArchive?.stackName).toBe("Letters"); // denormalized at completion
  expect(bankArchive?.stackId).toBeNull(); // origin stack deleted
  // Deleting a non-active stack must not move the pointer.
  expect(afterDeleteLetters.activeStackId).toBe(pileId);

  // -- Phase 7: delete the ACTIVE empty stack (Projects) — N=0 copy ---------
  const projectsRow = rowOf(page, "Projects");
  // Switch back to Projects first (another switch via the row button), so
  // the deletion below is the ACTIVE-STACK deletion: the drawer-front
  // survivor must then receive the active pointer (server truth).
  await projectsRow.locator(".stack-button").click();
  await expect(projectsRow).toContainText("— active");
  await projectsRow.getByRole("button", { name: "Actions for Projects" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Delete 'Projects'? It has no notes. Completed notes stay in the Archive."),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(projectsRow).toHaveCount(0);
  // Server truth: the drawer-front survivor (stacks[0], position 1) became
  // active — self-sufficient, true whether or not leftover stacks exist.
  const afterDeleteActive = await stateOf(request);
  expect(afterDeleteActive.activeStackId).toBe(afterDeleteActive.stacks[0]?.id);
  // Exactly ONE row carries the active marker, and it is that survivor.
  const markerRow = page.getByRole("listitem").filter({ hasText: "— active" });
  await expect(markerRow).toHaveCount(1);
  const survivorName = afterDeleteActive.stacks[0]?.name;
  expect(survivorName).not.toBeUndefined();
  await expect(page.getByRole("listitem").filter({ hasText: survivorName ?? "" })).toContainText(
    "— active",
  );

  // -- Phase 8: Close — the sheet is gone, the desk shows the survivor ------
  // Sheet-gone first: StackView beneath passes visible checks even if the
  // overlay never closed (list-view.spec.ts's closing-phase precedent).
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Stacks" })).toHaveCount(0);
  await expect(page.locator(".title")).toContainText(survivorName ?? "");

  // Context B (and its WS connection) must outlive the assertions above.
  await contextB.close();
});
