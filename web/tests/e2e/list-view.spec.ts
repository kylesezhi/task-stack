/**
 * ListView mechanics e2e (T19; sources: TASKS.md T19 Done-when, DESIGN.md
 * §5.3, DECISIONS.md §4/§11).
 *
 * ONE sequential test, deliberately: the specs share this run's DB
 * (web/playwright.config.ts), so phases build on each other — fresh stack
 * (via API, self-sufficient of first-run.spec.ts) → three notes → open the
 * sheet → drag-reorder → reload → edit → toss → empty sheet → close, with
 * server truth (`GET /api/state` through the same Vite proxy) asserted
 * after each mutation. Assertions are on durable/role-based locators
 * (getByRole, container-filtered rows), no testids, no Phase-2 styling —
 * so they survive the Phase-3 restyling (T23+) and (for hover-reveal, T32)
 * it cannot break these clicks because Playwright hovers before clicking.
 *
 * Push order A, B, C makes server positions 1,2,3 = C, B, A (new notes top
 * first), which is also the DOM order of the sheet's rows.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** Top-first texts of the sheet's rows, in DOM order (the note-text span
 * per row — the same durable class stack-view.spec.ts relies on). */
async function rowTexts(page: Page): Promise<string[]> {
  return page.getByRole("listitem").locator(".note-text").allTextContents();
}

/** Pending notes of the named stack, position-ascending (server truth). */
function pendingOf(state: AppState, stackId: string): AppState["notes"] {
  return state.notes
    .filter((note) => note.stackId === stackId)
    .sort((a, b) => a.position - b.position);
}

test("the list sheet reorders, edits, and tosses rows", async ({ page, request }) => {
  // -- Phase 1: setup via API — Garden with notes A, B, C -------------------
  const created = await request.post("/api/stacks", { data: { name: "Garden" } });
  expect(created.ok()).toBe(true);
  // POST /api/stacks replies 201 with the fresh AppState (server truth), and
  // creating a stack makes it active (T10).
  const afterCreate = (await created.json()) as AppState;
  const stackId = afterCreate.activeStackId;
  if (stackId === null) throw new Error("no active stack after POST /api/stacks");
  for (const text of ["Water the tomatoes", "Repot the fern", "Prune the hedge"]) {
    const pushed = await request.post(`/api/stacks/${stackId}/notes`, { data: { text } });
    expect(pushed.ok()).toBe(true);
  }
  await page.goto("/");

  // Pushed top-first: DOM order C, B, A.
  const C = "Prune the hedge";
  const B = "Repot the fern";
  const A = "Water the tomatoes";

  // -- Phase 2: "See all 3" opens the sheet; rows top-first C, B, A ---------
  await page.getByRole("button", { name: "See all 3" }).click();
  await expect(page.getByRole("heading", { name: "Garden — 3 notes" })).toBeVisible();

  const rowOf = (text: string) => page.getByRole("listitem").filter({ hasText: text });
  await expect(rowOf(A)).toBeVisible();
  await expect(rowOf(B)).toBeVisible();
  await expect(rowOf(C)).toBeVisible();
  await expect.poll(() => rowTexts(page)).toEqual([C, B, A]);

  // -- Phase 3: drag the bottom row's handle onto the top row ---------------
  // HTML5 DnD is not used (pointer events), so a real mouse drag is needed.
  // down ON the handle (pointerdown is bound to the ⠿ button), up over the
  // top row.
  const boxHandle = await rowOf(A).getByRole("button", { name: "Drag to reorder" }).boundingBox();
  const boxC = await rowOf(C).boundingBox();
  expect(boxHandle).not.toBeNull();
  expect(boxC).not.toBeNull();
  await page.mouse.move(boxHandle!.x + boxHandle!.width / 2, boxHandle!.y + boxHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxC!.x + boxC!.width / 2, boxC!.y + boxC!.height / 2, { steps: 8 });
  await page.mouse.up();

  // New order A, C, B — the drop is "insert at the target's slot".
  await expect(page.getByRole("listitem").filter({ hasText: A })).toBeVisible();
  await expect.poll(() => rowTexts(page)).toEqual([A, C, B]);
  const afterDrag = await stateOf(request);
  expect(pendingOf(afterDrag, stackId).map((note) => note.text)).toEqual([A, C, B]);
  expect(pendingOf(afterDrag, stackId).map((note) => note.position)).toEqual([1, 2, 3]);

  // -- Phase 4: reload preserves the order (the literal Done-when) ----------
  await page.reload();
  await expect(page.getByRole("button", { name: "See all 3" })).toBeVisible();
  await page.getByRole("button", { name: "See all 3" }).click();
  await expect(page.getByRole("heading", { name: "Garden — 3 notes" })).toBeVisible();
  await expect.poll(() => rowTexts(page)).toEqual([A, C, B]);
  const afterReload = await stateOf(request);
  expect(pendingOf(afterReload, stackId).map((note) => note.text)).toEqual([A, C, B]);

  // -- Phase 5: per-row edit — prefilled, whitespace guard, save, no reorder-
  await rowOf(B).getByRole("button", { name: "Edit" }).click();
  const listNoteText = page.getByLabel("Note text");
  await expect(listNoteText).toHaveValue(B);
  await listNoteText.fill("   ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await listNoteText.fill("Repot the fern — bigger pot");
  await page.getByRole("button", { name: "Save" }).click();
  const editedB = "Repot the fern — bigger pot";
  await expect(rowOf(editedB)).toBeVisible();
  // Editing must never reorder.
  await expect.poll(() => rowTexts(page)).toEqual([A, C, editedB]);
  const afterEdit = await stateOf(request);
  const pendingAfterEdit = pendingOf(afterEdit, stackId);
  expect(pendingAfterEdit.map((note) => note.text)).toEqual([A, C, editedB]);
  expect(pendingAfterEdit[2]?.position).toBe(3); // still last, as before
  const editedId = pendingAfterEdit[2]?.id;
  expect(editedId).not.toBeUndefined();

  // -- Phase 6: edit cancel (Cancel button) — draft discarded, text intact --
  await rowOf(editedB).getByRole("button", { name: "Edit" }).click();
  await listNoteText.fill("garbage");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => rowTexts(page)).toEqual([A, C, editedB]);

  // -- Phase 7: edit cancel (Esc) — cancels the EDIT, not the whole sheet ---
  // Esc on the list's input is consumed (stopPropagation), so App.svelte's
  // window Esc never closes the overlay here — the overlay-specific failure
  // mode a desk-side Esc test cannot distinguish.
  await rowOf(editedB).getByRole("button", { name: "Edit" }).click();
  await listNoteText.fill("garbage again");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Note text")).toHaveCount(0); // edit form gone
  await expect(page.getByRole("heading", { name: "Garden — 3 notes" })).toBeVisible(); // sheet STILL open
  await expect.poll(() => rowTexts(page)).toEqual([A, C, editedB]); // text untouched

  // -- Phase 8: toss a non-top row from the list; positions compact ---------
  const beforeToss = await stateOf(request);
  const completedBefore = beforeToss.completed.length;
  await rowOf(editedB).getByRole("button", { name: "Toss" }).click();
  await expect(rowOf(editedB)).toHaveCount(0);
  await expect.poll(() => rowTexts(page)).toEqual([A, C]);
  const afterToss = await stateOf(request);
  expect(afterToss.notes.some((note) => note.id === editedId)).toBe(false); // deleted
  const pendingAfterToss = pendingOf(afterToss, stackId);
  expect(pendingAfterToss.map((note) => note.text)).toEqual([A, C]);
  expect(pendingAfterToss.map((note) => note.position)).toEqual([1, 2]); // compacted 1..N
  // Toss adds nothing to (and takes nothing from) the archive (DECISIONS §4).
  expect(afterToss.completed).toHaveLength(completedBefore);
  expect(afterToss.completed.some((entry) => entry.text === editedB)).toBe(false);

  // -- Phase 9: tossing the rest → the §5.3 empty state ---------------------
  await rowOf(A).getByRole("button", { name: "Toss" }).click();
  await rowOf(C).getByRole("button", { name: "Toss" }).click();
  await expect(page.getByText("Nothing buried. Lucky you.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Garden — 0 notes" })).toBeVisible();

  // -- Phase 10: Close → back on the desk (empty stack line) ----------------
  // The sheet-gone assertion first: StackView beneath the opaque sheet passes
  // visible/toContainText checks even if the overlay never closed.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Garden — 0 notes" })).toHaveCount(0);
  await expect(page.getByText("The stack is empty.")).toBeVisible();
  await expect(page.locator(".title")).toContainText("Garden");
  await expect(page.locator(".title")).toContainText("0 notes");
});
