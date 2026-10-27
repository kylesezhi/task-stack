/**
 * Two-context sync e2e (T22; sources: TASKS.md T22 Done-when, the T12
 * server-side WS test it mirrors at the UI level).
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and spec files execute alphabetically — this
 * file sorts LAST ("sync" = "s-y" sorts after "stacks-drawer" = "s-t"), so
 * it must be a good citizen of whatever leftovers earlier specs produced:
 * it creates its own uniquely-named stack ("Sync desk") via the API (POST
 * makes it active, T10) and asserts only on that stack — presence of other
 * (leftover) rows is never asserted away. Its own leftovers (a stack with
 * one pending note and one completed entry) harm no one: nothing runs after.
 *
 * What this covers that the other specs do not: NOTE mutations landing in a
 * SECOND client via the WS broadcast. stacks-drawer.spec.ts (T20) covers a
 * second context receiving an active-stack SWITCH; T12 already covers the
 * same property server-side. Here client A pushes and completes notes through
 * the UI and client B must show the identical updated snapshots without a
 * reload — sequential mutations must not miss broadcasts.
 *
 * The no-reload proof: before the mutations, a sentinel property is stamped
 * onto B's `window` via evaluate. Every "B updated" assertion ALSO re-reads
 * the marker and requires the sentinel: a reload would reproduce the DOM but
 * DROP the marker, so marker-intact + DOM-updated makes "landed via WS in
 * the same page session" airtight (T20's switch test cannot distinguish
 * this). No bare `any` casts — the marker is read through a narrow
 * interface.
 *
 * Context precedent (T20): the default `page` is client A, a fresh
 * `browser.newContext()` holds client B — separate contexts, so separate WS
 * connections. Contexts created here are closed before the test ends (T20
 * rule: they must not outlive the test). Server truth (`GET /api/state`
 * through the same Vite proxy) is asserted after each mutation; durable
 * role/class locators only (.title / .note-text), no testids.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

const STACK = "Sync desk";
const NOTE_1 = "Feed the cat";
const NOTE_2 = "Charge the e-reader";
/** The sentinel value stamped onto B's window; absence ⇒ B reloaded. */
const SENTINEL = "same-page-session";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** The stack's pending note texts, position-ascending (server truth). */
function pendingTexts(state: AppState, stackId: string): string[] {
  return state.notes
    .filter((note) => note.stackId === stackId)
    .sort((a, b) => a.position - b.position)
    .map((note) => note.text);
}

/** The no-reload marker property, as B's window sees it. */
interface MarkedWindow {
  taskStackE2eNoReload?: string;
}

/** Stamps the marker onto B's window (nothing else anywhere sets it). */
async function setMarker(pageB: Page): Promise<void> {
  await pageB.evaluate(() => {
    (window as unknown as MarkedWindow).taskStackE2eNoReload = "same-page-session";
  });
}

/** Reads the marker back off B's window (undefined ⇒ B reloaded). */
function markerOf(pageB: Page): Promise<string | undefined> {
  return pageB.evaluate(() => (window as unknown as MarkedWindow).taskStackE2eNoReload);
}

test("note mutations land in a second WS client with no reload", async ({
  page,
  request,
  browser,
}) => {
  // -- Phase 1: setup via API — own uniquely-named stack, made active -------
  const created = await request.post("/api/stacks", { data: { name: STACK } });
  expect(created.status()).toBe(201);
  const afterCreate = (await created.json()) as AppState;
  const stackId = afterCreate.activeStackId;
  if (stackId === null) throw new Error("no active stack after POST /api/stacks");
  // Server truth baseline: the new stack exists, is empty, and is active.
  const baseline = await stateOf(request);
  expect(baseline.activeStackId).toBe(stackId);
  expect(baseline.notes.filter((note) => note.stackId === stackId)).toHaveLength(0);

  // -- Phase 2: two contexts, two desks, two WS connections -----------------
  // Precedent (stacks-drawer.spec.ts): the default `page` is client A, a
  // fresh context holds client B. Both load the same snapshot server state.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await page.goto("/");
  await pageB.goto("/");
  for (const desk of [page, pageB]) {
    await expect(desk.locator(".title")).toContainText(STACK);
    await expect(desk.locator(".title")).toContainText("0 notes");
  }

  // -- Phase 3: the no-reload marker on B (head comment) ---------------------
  await setMarker(pageB);
  await expect.poll(() => markerOf(pageB)).toBe(SENTINEL);

  // -- Phase 4: A pushes note 1 via the Push button → B updates live ---------
  const input = page.getByLabel("New note");
  await input.fill(NOTE_1);
  await page.getByRole("button", { name: "Push" }).click();
  // B received the broadcast: identical snapshot, in DOM form, without any
  // reload (marker still intact — a reload would have dropped it).
  await expect(pageB.locator(".note-text")).toHaveText(NOTE_1);
  await expect(pageB.locator(".title")).toContainText("1 note");
  expect(await markerOf(pageB)).toBe(SENTINEL);
  // A shows the same snapshot.
  await expect(page.locator(".note-text")).toHaveText(NOTE_1);
  await expect(page.locator(".title")).toContainText("1 note");
  await expect(input).toHaveValue("");
  // Server truth: the note is there, exactly once.
  const afterPush1 = await stateOf(request);
  expect(pendingTexts(afterPush1, stackId)).toEqual([NOTE_1]);

  // -- Phase 5: sequential mutation 2 — A pushes note 2 via Enter ------------
  await input.fill(NOTE_2);
  await input.press("Enter");
  // B updates live again: the new note on top, marker still intact.
  await expect(pageB.locator(".note-text")).toHaveText(NOTE_2);
  await expect(pageB.locator(".title")).toContainText("2 notes");
  expect(await markerOf(pageB)).toBe(SENTINEL);
  await expect(page.locator(".note-text")).toHaveText(NOTE_2);
  await expect(page.locator(".title")).toContainText("2 notes");
  const afterPush2 = await stateOf(request);
  expect(pendingTexts(afterPush2, stackId)).toEqual([NOTE_2, NOTE_1]);

  // -- Phase 6: sequential mutation 3 — A clicks Done → B updates live -------
  await page.getByRole("button", { name: "Done", exact: true }).click();
  // B's desk pops the same way: one note left, and it is note 1, marker
  // still intact.
  await expect(pageB.locator(".note-text")).toHaveText(NOTE_1);
  await expect(pageB.locator(".title")).toContainText("1 note");
  expect(await markerOf(pageB)).toBe(SENTINEL);
  await expect(page.locator(".note-text")).toHaveText(NOTE_1);
  await expect(page.locator(".title")).toContainText("1 note");
  const afterDone = await stateOf(request);
  expect(pendingTexts(afterDone, stackId)).toEqual([NOTE_1]);
  // Completed MEMBERSHIP only — leftover entries from earlier specs persist
  // by design (DECISIONS.md §6), so never a hardcoded global completed count.
  const doneNote = afterDone.completed.find((entry) => entry.text === NOTE_2);
  expect(doneNote).toBeDefined();
  expect(doneNote?.stackName).toBe(STACK); // denormalized at completion

  // -- Phase 7: contexts created here must not outlive the test (T20 rule) ---
  await contextB.close();
});
