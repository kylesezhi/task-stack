/**
 * ArchiveView mechanics e2e (T21; sources: TASKS.md T21 Done-when,
 * DESIGN.md §5.6, DECISIONS.md §6/§11).
 *
 * ONE sequential test, deliberately: the specs share this run's ONE DB
 * (web/playwright.config.ts) and its spec files run alphabetically.
 * archive-view.spec.ts sorts BEFORE first-run.spec.ts, which requires a
 * zero-stack DB at its start — so (a) this spec starts on the run's fresh DB
 * and asserts that precondition loudly (Phase 1: a failure there means the
 * alphabetical-run-first assumption broke), and (b) it ends by deleting
 * every stack via the API to restore the zero-stacks DB first-run.spec.ts
 * needs. completed rows are never touched: they persist by design
 * (DECISIONS.md §6 — stack DELETE keeps them, dropping stack_id to NULL), so
 * leaving them in the run DB harms no later spec.
 *
 * Server truth (`GET /api/state` through the same Vite proxy) is asserted
 * after each mutation. Assertions are on durable/role-based locators
 * (getByRole, section.day/.entry/.note-text/.chip/.time — the same
 * durable-class precedent as the other specs), no testids, no Phase-2
 * styling. Day labels are deterministic: the labeler is fixed "en-US"
 * (web/src/lib/archive.ts), "Jun 14, 2024" always carries the year suffix
 * for any now ≥ 2025, and browser + runner share the system timezone.
 *
 * Group scoping uses section.day filtered by an EXACT heading ("Today" is
 * not a substring of any other label) — no index-based section lookup.
 *
 * Accepted midnight-crossing edge: a run spanning local midnight between
 * this spec's "today" completions and its later assertions could relabel
 * those rows as Yesterday (grouping is by the LOCAL calendar day) — the same
 * clock-trust class as created_at everywhere else in this app.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AppState } from "@task-stack/shared";

/** GET /api/state parsed — server truth behind every mutation claim. */
async function stateOf(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AppState;
}

/** The day-group section whose h3 reads exactly `label` ("Today" matches no
 * other label as a substring, so exact-name scoping is safe). */
function daySection(page: Page, label: string) {
  return page.locator("section.day", {
    has: page.getByRole("heading", { name: label, exact: true }),
  });
}

/** The day-group section's row texts (note-text spans, DOM order). */
async function dayRowTexts(page: Page, label: string): Promise<string[]> {
  return daySection(page, label).locator(".entry").locator(".note-text").allTextContents();
}

test("the archive groups completed notes by day, newest first", async ({ page, request }) => {
  // -- Phase 1: precondition + setup — fresh DB, then "Paperwork" -----------
  // LOUD precondition: this spec runs FIRST alphabetically, so the run's DB
  // must be untouched leftovers-wise. A non-empty completed list here means
  // the alphabetical-run-first assumption broke (a new spec or a re-order).
  const initial = await stateOf(request);
  expect(initial.completed).toEqual([]);
  expect(initial.stacks).toEqual([]); // first-run.spec.ts's precondition too
  const created = await request.post("/api/stacks", { data: { name: "Paperwork" } });
  // 201: stack-create mints an entity (server stacks.ts precedent), and the
  // reply body is the fresh AppState where the new stack is already active.
  expect(created.status()).toBe(201);
  const afterCreate = (await created.json()) as AppState;
  const stackId = afterCreate.activeStackId;
  if (stackId === null) throw new Error("no active stack after POST /api/stacks");
  await page.goto("/");

  // -- Phase 2: the empty state, exact §5.6 copy ----------------------------
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("0 done")).toBeVisible();
  await expect(page.getByText("Nothing done yet. Push something.")).toBeVisible();

  // -- Phase 3: WS pushes completions into the OPEN sheet, no reload --------
  // Push both, then complete the passport FIRST so the herbs are the newer
  // entry (newest-first order below). By id, from the push responses' fresh
  // AppStates (server truth, not the UI's).
  const passportRes = await request.post(`/api/stacks/${stackId}/notes`, {
    data: { text: "Renew the passport" },
  });
  expect(passportRes.status()).toBe(201);
  const afterPassport = (await passportRes.json()) as AppState;
  const passportId = afterPassport.notes.find((note) => note.text === "Renew the passport")?.id;
  expect(passportId).toBeDefined();
  const herbsRes = await request.post(`/api/stacks/${stackId}/notes`, {
    data: { text: "Water the herbs" },
  });
  expect(herbsRes.status()).toBe(201);
  const afterHerbs = (await herbsRes.json()) as AppState;
  const herbsId = afterHerbs.notes.find((note) => note.text === "Water the herbs")?.id;
  expect(herbsId).toBeDefined();
  const passportDone = await request.post(`/api/notes/${passportId}/complete`);
  expect(passportDone.ok()).toBe(true);
  const herbsDone = await request.post(`/api/notes/${herbsId}/complete`);
  expect(herbsDone.ok()).toBe(true);

  const afterCompletions = await stateOf(request);
  expect(afterCompletions.completed).toHaveLength(2);
  expect(afterCompletions.notes).toHaveLength(0);

  // The open sheet must have updated via the WS broadcast (no reload): the
  // Today group with the newest completion first. THE EXPECTED ORDER IS
  // DERIVED FROM SERVER TRUTH, not hardcoded: normally the herbs (completed
  // last) are newest, but if the two completes land on the same millisecond
  // server truth tie-breaks by id ASC (random UUIDs), which would make a
  // hardcoded order flake — `afterCompletions.completed` already IS that
  // newest-first server order, so following it keeps the test deterministic
  // either way.
  await expect(page.getByText("2 done")).toBeVisible();
  const todayTexts = afterCompletions.completed
    .map((entry) => entry.text)
    .filter((text) => text === "Water the herbs" || text === "Renew the passport");
  await expect.poll(() => dayRowTexts(page, "Today")).toEqual(todayTexts);
  const today = daySection(page, "Today");
  await expect(today.locator(".chip")).toHaveText(["Paperwork", "Paperwork"]);
  // Visible time text is the local "11:42" shape; each row's datetime must
  // equal the ISO the server stamped for THAT row's note — paired by row
  // TEXT via a text→completedAt map, not by position, so a same-millisecond
  // id-ASC tie cannot scramble the pairing.
  const times = today.locator("time");
  await expect(times).toHaveCount(2);
  const completedAtByText = new Map(
    afterCompletions.completed.map((entry) => [entry.text, entry.completedAt]),
  );
  const rows = today.locator(".entry");
  for (let index = 0; index < (await rows.count()); index += 1) {
    const rowText = (await rows.nth(index).locator(".note-text").textContent()) ?? "";
    const rowTime = rows.nth(index).locator("time");
    await expect(rowTime).toHaveAttribute("datetime", completedAtByText.get(rowText) ?? "");
    await expect(rowTime).toHaveText(/\d{1,2}:\d{2}/);
  }
  await expect(page.getByText("Nothing done yet. Push something.")).toHaveCount(0);

  // -- Phase 4: seed older days directly in SQLite --------------------------
  // The API stamps real time, so plural day groups can only come from
  // back-dated rows: open the run's ONE DB (TASK_STACK_E2E_WORK_DIR + the
  // "data.db" filename playwright.config.ts computes — keep the two in sync;
  // teardown.ts reads the same env var under the same contract). The server
  // holds the DB, but WAL makes a short concurrent writer safe; a
  // busy_timeout covers the contention window. The handle is closed as soon
  // as the inserts land.
  const workDir = process.env["TASK_STACK_E2E_WORK_DIR"];
  if (typeof workDir !== "string" || workDir.length === 0) {
    throw new Error(
      "TASK_STACK_E2E_WORK_DIR is not set — playwright.config.ts (the launcher eval) " +
        "must evaluate first; teardown.ts depends on the identical contract",
    );
  }
  const yesterdayIso = (() => {
    // The constructor normalizes day underflow across month/year boundaries;
    // local hours (13:00) are already runner-timezone-relative by design —
    // the browser groups by ITS local clock, which shares the runner's TZ.
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 13, 0, 0).toISOString();
  })();
  const yesterday1305Iso = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 13, 5, 0).toISOString();
  })();
  const june2024Iso = new Date(2024, 5, 14, 12, 0, 0).toISOString();
  const db = new DatabaseSync(join(workDir, "data.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    // created_at AND completed_at are the same back-dated ISO on purpose:
    // completed_at is what the archive orders and groups by, created_at is
    // preserved through completion (server notes.ts precedent).
    const insert = db.prepare(
      "INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    // Two yesterday rows (stack still alive → real stack_id), one 2024 row
    // in the post-stack-delete shape: stack_id NULL, the denormalized name
    // keeps the chip readable (T10 / DECISIONS.md §6).
    insert.run(randomUUID(), "File the receipts", stackId, "Paperwork", yesterdayIso, yesterdayIso);
    insert.run(
      randomUUID(),
      "Shred the junk mail",
      stackId,
      "Paperwork",
      yesterday1305Iso,
      yesterday1305Iso,
    );
    insert.run(randomUUID(), "Close the old studio", null, "Old job", june2024Iso, june2024Iso);
  } finally {
    db.close();
  }

  // -- Phase 5: reload → the full multi-day DOM ------------------------------
  await page.reload();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  // Day-group headings in order — deterministic (fixed en-US labeler; 2024
  // always carries the year suffix for any now ≥ 2025).
  await expect.poll(() => daySection(page, "Today").count()).toBe(1); // wait for the WS snapshot before reading the DOM below
  const labels = await page.locator("section.day").locator("h3").allTextContents();
  expect(labels).toEqual(["Today", "Yesterday", "Jun 14, 2024"]);
  // Per-group shape: 2 / 2 / 1 rows.
  await expect(daySection(page, "Today").locator(".entry")).toHaveCount(2);
  await expect(daySection(page, "Yesterday").locator(".entry")).toHaveCount(2);
  await expect(daySection(page, "Jun 14, 2024").locator(".entry")).toHaveCount(1);
  // Within Yesterday, the 13:05 row beats the 13:00 row (newest first).
  await expect
    .poll(() => dayRowTexts(page, "Yesterday"))
    .toEqual(["Shred the junk mail", "File the receipts"]);
  // The 2024 row's chip reads the denormalized name despite stack_id NULL.
  await expect(daySection(page, "Jun 14, 2024").locator(".chip")).toHaveText("Old job");
  // Header total across all days.
  await expect(page.getByText("5 done")).toBeVisible();
  // Every visible time is the "11:42" shape; the SEEDED rows' datetime
  // attributes equal the exact ISO strings inserted in Phase 4.
  const yesterdayTimes = daySection(page, "Yesterday").locator("time");
  await expect(yesterdayTimes).toHaveCount(2);
  await expect(yesterdayTimes.nth(0)).toHaveAttribute("datetime", yesterday1305Iso);
  await expect(yesterdayTimes.nth(1)).toHaveAttribute("datetime", yesterdayIso);
  await expect(daySection(page, "Jun 14, 2024").locator("time")).toHaveAttribute(
    "datetime",
    june2024Iso,
  );
  for (const section of ["Today", "Yesterday", "Jun 14, 2024"] as const) {
    const sectionTimes = daySection(page, section).locator("time");
    const count = await sectionTimes.count();
    for (let index = 0; index < count; index += 1) {
      await expect(sectionTimes.nth(index)).toHaveText(/\d{1,2}:\d{2}/);
    }
  }

  // -- Phase 6: Close returns to the desk ------------------------------------
  // Sheet-gone first: StackView beneath the opaque sheet passes visible
  // checks even if the overlay never closed (list-view.spec.ts precedent).
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toHaveCount(0);
  // Both notes were completed, so the desk shows the empty-stack line.
  await expect(page.locator(".title")).toContainText("Paperwork");
  await expect(page.getByText("The stack is empty.")).toBeVisible();

  // -- Phase 7: suite citizenship — restore the zero-stacks DB ---------------
  // first-run.spec.ts (runs AFTER this file alphabetically) needs a
  // zero-stack DB; completed rows persist by design and are left alone.
  const beforeCleanup = await stateOf(request);
  for (const stack of beforeCleanup.stacks) {
    const removed = await request.delete(`/api/stacks/${stack.id}`);
    expect(removed.status()).toBe(200);
  }
  const finalState = await stateOf(request);
  expect(finalState.stacks).toEqual([]);
  expect(finalState.activeStackId).toBeNull();
  // Cleanup must never touch the archive: exactly these five entries (by
  // text, not just a count) survived the stack deletions — a count alone
  // could hide a dropped or swapped row.
  expect(finalState.completed.map((entry) => entry.text).sort()).toEqual(
    [
      "Renew the passport",
      "Water the herbs",
      "File the receipts",
      "Shred the junk mail",
      "Close the old studio",
    ].sort(),
  );
});
