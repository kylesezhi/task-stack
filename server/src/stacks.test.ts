import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "@task-stack/shared";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { withTransaction } from "./stacks.js";

// Integration tests for the T10 stack routes, against real file DBs (never
// :memory:), seeded with raw SQL and fixed ISO timestamps so every expected
// snapshot is exact and human-checkable. The done-when clauses map to:
// - create → becomes active: "creates the first stack…" + "appends the second…"
// - delete kills pending notes, archive survives under its stack name:
//   "deletes pending notes, keeps the archive rows…"
// - switching active updates settings: "switches the active stack and the
//   write persists" (asserted via a follow-up GET, not just the response).
// Mutation routes all answer with the fresh full snapshot from getAppState —
// several tests re-prove this by comparing the mutation response to a
// follow-up GET /api/state. Cleanup helpers mirror state.test.ts (tracked
// opens, sidecar-safe rm, never the repo's own server/data.db).
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-stacks-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type InsertParameters = readonly (string | number | null)[];

function run(db: DatabaseSync, sql: string, params: InsertParameters): void {
  db.prepare(sql).run(...params);
}

function insertStack(
  db: DatabaseSync,
  id: string,
  name: string,
  position: number,
  createdAt: string,
): void {
  run(db, "INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)", [
    id,
    name,
    position,
    createdAt,
  ]);
}

function insertNote(
  db: DatabaseSync,
  id: string,
  stackId: string,
  text: string,
  position: number,
): void {
  run(db, "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    stackId,
    text,
    position,
    "2024-02-01T10:00:00.000Z",
  ]);
}

function insertCompleted(
  db: DatabaseSync,
  id: string,
  stackId: string | null,
  stackName: string,
  createdAt: string,
  completedAt: string,
): void {
  run(
    db,
    `INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, `${id} text`, stackId, stackName, createdAt, completedAt],
  );
}

function setActive(db: DatabaseSync, stackId: string): void {
  run(
    db,
    `INSERT INTO settings (key, value) VALUES ('active_stack_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [stackId],
  );
}

/**
 * Canonical drawer: Alpha(1) / Beta(2) / Gamma(3), active = Beta, one note on
 * Alpha so PATCH and PUT-active tests prove those routes never touch notes.
 */
function seedDrawer(db: DatabaseSync): void {
  insertStack(db, "s1", "Alpha", 1, "2024-01-01T09:00:00.000Z");
  insertStack(db, "s2", "Beta", 2, "2024-01-02T09:00:00.000Z");
  insertStack(db, "s3", "Gamma", 3, "2024-01-03T09:00:00.000Z");
  insertNote(db, "n1", "s1", "one lonely note", 1);
  setActive(db, "s2");
}

/**
 * Deletion fixture: Work (two pending notes + one archived note) ahead of Home
 * (one pending note + one archived note) in the drawer, active = Work —
 * deleting Work must null Work's archive row's stack_id while Home's rows
 * (pending AND archived) are untouched.
 */
function seedWorkHome(db: DatabaseSync): void {
  insertStack(db, "s1", "Work", 1, "2024-01-01T09:00:00.000Z");
  insertStack(db, "s2", "Home", 2, "2024-01-02T09:00:00.000Z");
  insertNote(db, "n1", "s1", "email Lee", 1);
  run(db, "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)", [
    "n2",
    "s1",
    "write the shelf docs",
    2,
    "2024-02-02T10:00:00.000Z",
  ]);
  insertNote(db, "n3", "s2", "water the plants", 1);
  insertCompleted(db, "c1", "s1", "Work", "2024-01-25T08:00:00.000Z", "2024-03-03T12:00:00.000Z");
  insertCompleted(db, "c2", "s2", "Home", "2024-01-26T08:00:00.000Z", "2024-03-04T12:00:00.000Z");
  setActive(db, "s1");
}

describe("POST /api/stacks", () => {
  it("creates the first stack at drawer position 1 and makes it active", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Work" },
      });
      // Create answers 201 and the same fresh snapshot GET /api/state serves.
      expect(res.statusCode).toBe(201);
      const body = res.json() as AppState;
      expect(body.stacks).toHaveLength(1);
      const [work] = body.stacks;
      expect(work?.name).toBe("Work");
      expect(work?.position).toBe(1);
      // Generated server-side; must round-trip as canonical ISO-8601 UTC.
      expect(Number.isNaN(Date.parse(work?.createdAt ?? ""))).toBe(false);
      expect(body.activeStackId).toBe(work?.id);
      expect(body.notes).toEqual([]);
      expect(body.completed).toEqual([]);
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("appends the second and third stacks to the back of the drawer and switches active to each new one", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Work" },
      });
      const workId = (first.json() as AppState).activeStackId;
      expect(workId).toBeTypeOf("string");

      const second = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Home" },
      });
      expect(second.statusCode).toBe(201);
      const afterSecond = second.json() as AppState;
      expect(afterSecond.stacks.map((stack) => stack.name)).toEqual(["Work", "Home"]);
      expect(afterSecond.stacks.map((stack) => stack.position)).toEqual([1, 2]);
      expect(afterSecond.activeStackId).toBe(afterSecond.stacks[1]?.id);
      expect(afterSecond.activeStackId).not.toBe(workId);

      const third = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Errands" },
      });
      expect(third.statusCode).toBe(201);
      const afterThird = third.json() as AppState;
      expect(afterThird.stacks.map((stack) => [stack.name, stack.position])).toEqual([
        ["Work", 1],
        ["Home", 2],
        ["Errands", 3],
      ]);
      expect(afterThird.activeStackId).toBe(afterThird.stacks[2]?.id);
    } finally {
      await app.close();
    }
  });

  it("appends after MAX(position), not COUNT(*), when the drawer has a gap", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db); // Alpha(1) Beta(2) Gamma(3)
    const app = await buildApp({ db });
    try {
      // Adjudicated delete decision leaves the gap: survivors sit at 1 and 3.
      const afterDelete = await app.inject({ method: "DELETE", url: "/api/stacks/s2" });
      expect((afterDelete.json() as AppState).stacks.map((stack) => stack.position)).toEqual([
        1, 3,
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Delta" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as AppState;
      // MAX(3)+1 = 4 — a COUNT(*)+1 refactor would silently renumber onto 3.
      const [delta] = body.stacks.slice(-1);
      expect(body.stacks.map((stack) => [stack.name, stack.position])).toEqual([
        ["Alpha", 1],
        ["Gamma", 3],
        ["Delta", 4],
      ]);
      expect(body.activeStackId).toBe(delta?.id);
    } finally {
      await app.close();
    }
  });

  it("rejects an empty name with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "POST", url: "/api/stacks", payload: { name: "" } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
    } finally {
      await app.close();
    }
  });

  it("rejects a whitespace-only name with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "   " },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
    } finally {
      await app.close();
    }
  });

  it("rejects an unknown key with 400 (strictObject) and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Work", force: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
    } finally {
      await app.close();
    }
  });
});

describe("PATCH /api/stacks/:id", () => {
  it("renames without touching drawer order, notes, or the active stack", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s1",
        payload: { name: "Alpha renamed" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        activeStackId: "s2",
        stacks: [
          { id: "s1", name: "Alpha renamed", position: 1, createdAt: "2024-01-01T09:00:00.000Z" },
          { id: "s2", name: "Beta", position: 2, createdAt: "2024-01-02T09:00:00.000Z" },
          { id: "s3", name: "Gamma", position: 3, createdAt: "2024-01-03T09:00:00.000Z" },
        ],
        notes: [
          {
            id: "n1",
            stackId: "s1",
            text: "one lonely note",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [],
      } satisfies AppState);
      // Same body a follow-up GET returns: response === server state.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("moves a stack to a later slot, shifting neighbors to a contiguous 1..N", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { position: 3 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        activeStackId: "s2",
        stacks: [
          { id: "s1", name: "Alpha", position: 1, createdAt: "2024-01-01T09:00:00.000Z" },
          { id: "s3", name: "Gamma", position: 2, createdAt: "2024-01-03T09:00:00.000Z" },
          { id: "s2", name: "Beta", position: 3, createdAt: "2024-01-02T09:00:00.000Z" },
        ],
        notes: [
          {
            id: "n1",
            stackId: "s1",
            text: "one lonely note",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [],
      } satisfies AppState);
    } finally {
      await app.close();
    }
  });

  it("moves a stack to the front slot — insert-at works in the earlier direction too", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s3",
        payload: { position: 1 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        activeStackId: "s2",
        stacks: [
          { id: "s3", name: "Gamma", position: 1, createdAt: "2024-01-03T09:00:00.000Z" },
          { id: "s1", name: "Alpha", position: 2, createdAt: "2024-01-01T09:00:00.000Z" },
          { id: "s2", name: "Beta", position: 3, createdAt: "2024-01-02T09:00:00.000Z" },
        ],
        notes: [
          {
            id: "n1",
            stackId: "s1",
            text: "one lonely note",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [],
      } satisfies AppState);
    } finally {
      await app.close();
    }
  });

  it("renames and moves in one PATCH — one transaction covers name and positions", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { name: "Beta renamed", position: 3 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        activeStackId: "s2",
        stacks: [
          { id: "s1", name: "Alpha", position: 1, createdAt: "2024-01-01T09:00:00.000Z" },
          { id: "s3", name: "Gamma", position: 2, createdAt: "2024-01-03T09:00:00.000Z" },
          { id: "s2", name: "Beta renamed", position: 3, createdAt: "2024-01-02T09:00:00.000Z" },
        ],
        notes: [
          {
            id: "n1",
            stackId: "s1",
            text: "one lonely note",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [],
      } satisfies AppState);
    } finally {
      await app.close();
    }
  });

  it("accepts a position equal to the current one as a valid no-op", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { position: 2 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(before.json());
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects a position past the drawer end with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { position: 4 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "position 4 is out of range (drawer has 3 stacks)" });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects a zero and a fraction. Both are zod schema failures before any drawer math runs", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const zero = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { position: 0 },
      });
      expect(zero.statusCode).toBe(400);
      expect(zero.json()).toHaveProperty("error");
      const fractional = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s2",
        payload: { position: 1.5 },
      });
      expect(fractional.statusCode).toBe(400);
      expect(fractional.json()).toHaveProperty("error");
      // Schema failures must short-circuit before any SQL runs.
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects an empty patch body with 400 (the refine must surface)", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "PATCH", url: "/api/stacks/s1", payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: "PATCH body must contain at least one field (name or position)",
      });
    } finally {
      await app.close();
    }
  });

  it("rejects an unknown key with 400 (strictObject)", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s1",
        payload: { name: "X", extra: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown stack id", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/stacks/ghost",
        payload: { name: "X" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Stack not found" });
    } finally {
      await app.close();
    }
  });
});

describe("DELETE /api/stacks/:id", () => {
  it("deletes pending notes, keeps archive rows under their stack names, other stacks untouched", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/stacks/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        // Work was the active stack → Home (the only survivor) takes over.
        activeStackId: "s2",
        stacks: [{ id: "s2", name: "Home", position: 2, createdAt: "2024-01-02T09:00:00.000Z" }],
        notes: [
          // n1/n2 lived on Work — pending notes die with their stack. n3 (Home)
          // survives untouched.
          {
            id: "n3",
            stackId: "s2",
            text: "water the plants",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [
          // Newest first: c2 (Home, untouched — still points at s2) then c1 —
          // nulled to stackId: null because its originating stack is gone, but
          // the denormalized stack_name keeps the archive readable.
          {
            id: "c2",
            text: "c2 text",
            stackId: "s2",
            stackName: "Home",
            createdAt: "2024-01-26T08:00:00.000Z",
            completedAt: "2024-03-04T12:00:00.000Z",
          },
          {
            id: "c1",
            text: "c1 text",
            stackId: null, // nulled at deletion — the stack it pointed at is gone
            stackName: "Work", // denormalized name keeps the archive readable
            createdAt: "2024-01-25T08:00:00.000Z",
            completedAt: "2024-03-03T12:00:00.000Z",
          },
        ],
      } satisfies AppState);
      // Same body a follow-up GET returns: response === server state.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("returns to the first-run shape when the last stack goes", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Work" },
      });
      const workId = (created.json() as AppState).activeStackId;
      expect(workId).toBeTypeOf("string");
      const res = await app.inject({ method: "DELETE", url: `/api/stacks/${workId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
    } finally {
      await app.close();
    }
  });

  it("leaves activeStackId unchanged when deleting a non-active stack", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db); // active = Beta (s2)
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/stacks/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        // Beta stays active — only the deleted stack could have moved the pointer.
        activeStackId: "s2",
        stacks: [
          { id: "s2", name: "Beta", position: 2, createdAt: "2024-01-02T09:00:00.000Z" },
          { id: "s3", name: "Gamma", position: 3, createdAt: "2024-01-03T09:00:00.000Z" },
        ],
        notes: [],
        completed: [],
      } satisfies AppState);
    } finally {
      await app.close();
    }
  });

  it("hands active to the drawer-FRONT survivor, not the stack that followed the deleted one", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db); // Alpha(1, inactive) Beta(2, active) Gamma(3)
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/stacks/s2" });
      expect(res.statusCode).toBe(200);
      // Survivors are Alpha(1) and Gamma(2); choosing "first in drawer order"
      // lands on Alpha. Anything like an accidental "next after deleted"
      // would pick Gamma — this fixture distinguishes the two.
      expect((res.json() as AppState).activeStackId).toBe("s1");
    } finally {
      await app.close();
    }
  });

  it("survives a close/reopen cycle — the delete commits rather than leaking from a rolled-back transaction", async () => {
    const path = tempDbPath();
    const db = trackedOpen(path);
    seedWorkHome(db);
    const app = await buildApp({ db });
    let afterDelete: AppState;
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/stacks/s1" });
      expect(res.statusCode).toBe(200);
      afterDelete = res.json() as AppState;
    } finally {
      await app.close();
      db.close();
    }

    // Reopen the SAME file and prove the disk state matches what the API said.
    const reopened = trackedOpen(path);
    const reopenedApp = await buildApp({ db: reopened });
    try {
      const state = await reopenedApp.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual(afterDelete satisfies AppState);
    } finally {
      await reopenedApp.close();
    }
  });

  it("404s for an unknown stack id and for a stack already deleted", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const ghost = await app.inject({ method: "DELETE", url: "/api/stacks/ghost" });
      expect(ghost.statusCode).toBe(404);
      expect(ghost.json()).toEqual({ error: "Stack not found" });

      await app.inject({ method: "DELETE", url: "/api/stacks/s1" });
      const again = await app.inject({ method: "DELETE", url: "/api/stacks/s1" });
      expect(again.statusCode).toBe(404);
      expect(again.json()).toEqual({ error: "Stack not found" });
    } finally {
      await app.close();
    }
  });
});

describe("PUT /api/active", () => {
  it("switches the active stack and the write persists", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/active",
        payload: { stackId: "s1" },
      });
      expect(res.statusCode).toBe(200);
      const expected = {
        activeStackId: "s1",
        stacks: [
          { id: "s1", name: "Alpha", position: 1, createdAt: "2024-01-01T09:00:00.000Z" },
          { id: "s2", name: "Beta", position: 2, createdAt: "2024-01-02T09:00:00.000Z" },
          { id: "s3", name: "Gamma", position: 3, createdAt: "2024-01-03T09:00:00.000Z" },
        ],
        notes: [
          {
            id: "n1",
            stackId: "s1",
            text: "one lonely note",
            position: 1,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
        ],
        completed: [],
      } satisfies AppState;
      expect(res.json()).toEqual(expected);
      // The done-when clause: switching must actually update settings, not just
      // echo the requested value back — prove it on a fresh read.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual(expected);
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown stack id and leaves the active pointer untouched", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/active",
        payload: { stackId: "ghost" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Stack not found" });
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect((state.json() as AppState).activeStackId).toBe("s2");
    } finally {
      await app.close();
    }
  });

  it("rejects an empty stackId with 400", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/active",
        payload: { stackId: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
    } finally {
      await app.close();
    }
  });

  it("rejects a blank (whitespace-only) stackId with 400", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/active",
        payload: { stackId: " " },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "id must contain a non-whitespace character" });
    } finally {
      await app.close();
    }
  });

  it("rejects an unknown key with 400 (strictObject)", async () => {
    const db = trackedOpen(tempDbPath());
    seedDrawer(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/active",
        payload: { stackId: "s1", extra: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
    } finally {
      await app.close();
    }
  });
});

describe("withTransaction", () => {
  /** Direct row count — no HTTP indirection, this asserts raw SQL state. */
  function stackCount(db: DatabaseSync): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM stacks").get() as { count: number };
    return row.count;
  }

  it("rolls back when the callback throws and leaves no open transaction", () => {
    const db = trackedOpen(tempDbPath());
    expect(() =>
      withTransaction(db, () => {
        insertStack(db, "s-broken", "Broken", 1, "2024-01-01T09:00:00.000Z");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // The insert never escapes the failed transaction.
    expect(stackCount(db)).toBe(0);
    // The REAL no-dangling-transaction proof: the failed one cannot have been
    // left open, since isTransaction reads straight off the connection.
    expect(db.isTransaction).toBe(false);
    // A db-usability check after the rollback (mirrors the count assertion).
    insertStack(db, "s-ok", "Ok", 1, "2024-01-01T09:00:00.000Z");
    expect(stackCount(db)).toBe(1);
  });

  it("rejects an async callback loudly and rolls back the statements it already ran", () => {
    const db = trackedOpen(tempDbPath());
    expect(() =>
      withTransaction(db, async () => {
        // Runs synchronously inside the BEGIN, must be undone by the guard.
        insertStack(db, "s-async", "Async", 1, "2024-01-01T09:00:00.000Z");
      }),
    ).toThrow(/synchronous callback/);
    expect(stackCount(db)).toBe(0);
    // The REAL no-dangling-transaction proof (see the throw-callback test).
    expect(db.isTransaction).toBe(false);
    // A db-usability check after the rollback (mirrors the count assertion).
    insertStack(db, "s-ok", "Ok", 1, "2024-01-01T09:00:00.000Z");
    expect(stackCount(db)).toBe(1);
  });
});
