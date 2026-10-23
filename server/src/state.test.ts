import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "@task-stack/shared";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

// Integration test for the full state snapshot against real file DBs (never
// :memory:). Fixtures are seeded with raw SQL using fixed ISO timestamps and
// readable ids (s1, n2, c3…) so the expected JSON is human-checkable line by
// line. What the seeding deliberately proves, when the naive alternative
// would also produce the expected JSON:
// - Stacks are inserted last-drawer-first (drawer 3 → drawer 1), and drawer
//   order is NOT lexical id order (drawer 1 is s2, drawer 3 is s1), so both
//   "return as inserted" and "sort by id" would fail the expectation — only
//   ORDER BY position survives.
// - Notes within a stack insert as 2, 1, 3 (never in output order).
// - Completed rows insert in scattered completed_at order, and the two rows
//   sharing the exact same completed_at are inserted in the order OPPOSITE to
//   the expected output (see below), so without the id tie-break the rowid
//   order SQLite actually returns would disagree.
// Temp-file/cleanup helpers mirror db.test.ts (sidecar-safe rm, never the
// repo's own server/data.db).
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-state-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

type InsertParameters = readonly (string | number | null)[];

function run(db: DatabaseSync, sql: string, params: InsertParameters): void {
  db.prepare(sql).run(...params);
}

function seedFixture(db: DatabaseSync): void {
  const stacksSql = "INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)";
  const notesSql =
    "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)";
  const completedSql =
    "INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)";

  // Drawer order must come out as Groceries(1), Home(2), Work(3) — deliberately
  // NOT lexical id order — while insertion runs last-drawer-first: Work lands
  // first and Groceries last, so "return as inserted" cannot pass either.
  run(db, stacksSql, ["s1", "Work", 3, "2024-01-01T09:00:00.000Z"]);
  run(db, stacksSql, ["s3", "Home", 2, "2024-01-03T09:00:00.000Z"]);
  run(db, stacksSql, ["s2", "Groceries", 1, "2024-01-02T09:00:00.000Z"]);

  // Notes in mixed order; Work's three notes insert as 2, 1, 3 so top-of-stack
  // must come out sorted, not first-inserted.
  run(db, notesSql, ["n1", "s1", "write the shelf docs", 2, "2024-02-01T10:00:00.000Z"]);
  run(db, notesSql, ["n2", "s1", "email Lee", 1, "2024-01-31T10:00:00.000Z"]);
  run(db, notesSql, ["n3", "s1", "book the dentist", 3, "2024-02-02T10:00:00.000Z"]);
  run(db, notesSql, ["n4", "s2", "oat milk", 1, "2024-02-03T10:00:00.000Z"]);
  run(db, notesSql, ["n5", "s3", "water the plants", 1, "2024-02-04T10:00:00.000Z"]);

  // Completed notes in deliberately NON-DESC completed_at order. c3 and c4
  // share the exact same completed_at, and c4 is inserted BEFORE c3 — SQLite's
  // rowid order for the tie pair would therefore return c4 first, so the
  // expected [c3, c4] proves the id ASC tie-break, not insertion luck.
  // c4 has a null stack_id — its originating stack has been deleted, and the
  // row survives with the denormalized stack_name.
  run(db, completedSql, [
    "c4",
    "install the mirror",
    null,
    "Old Stack",
    "2024-01-10T08:00:00.000Z",
    "2024-03-03T12:00:00.000Z",
  ]);
  run(db, completedSql, [
    "c1",
    "water the fern",
    "s2",
    "Groceries",
    "2024-01-15T08:00:00.000Z",
    "2024-03-01T12:00:00.000Z",
  ]);
  run(db, completedSql, [
    "c2",
    "buy desk lamp",
    "s1",
    "Work",
    "2024-01-20T08:00:00.000Z",
    "2024-03-02T12:00:00.000Z",
  ]);
  run(db, completedSql, [
    "c3",
    "call the bank",
    "s1",
    "Work",
    "2024-01-25T08:00:00.000Z",
    "2024-03-03T12:00:00.000Z",
  ]);

  // Active stack is a drawer-MIDDLE stack (Home, drawer 2) — not the first —
  // to prove the value is read from settings rather than defaulted/misderived.
  run(db, "INSERT INTO settings (key, value) VALUES ('active_stack_id', 's3')", []);
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/state", () => {
  it("returns the full seeded snapshot with query-driven ordering", async () => {
    const db = trackedOpen(tempDbPath());
    seedFixture(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expectedState);
    } finally {
      await app.close();
    }
  });

  it("breaks same-position stack ties by id ASC against insertion order", async () => {
    // Pathological on purpose: the API always assigns distinct drawer
    // positions, so equal positions are unreachable in production. This
    // focused test exists only to regression-guard the documented id ASC
    // tie-break at the stacks level: s-b is inserted FIRST, so rowid order
    // would return s-b first — expecting s-a first proves the tie-break.
    const db = trackedOpen(tempDbPath());
    const sql = "INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)";
    run(db, sql, ["s-b", "First by insertion", 1, "2024-04-02T09:00:00.000Z"]);
    run(db, sql, ["s-a", "First by tie-break", 1, "2024-04-01T09:00:00.000Z"]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        activeStackId: null,
        stacks: [
          {
            id: "s-a",
            name: "First by tie-break",
            position: 1,
            createdAt: "2024-04-01T09:00:00.000Z",
          },
          {
            id: "s-b",
            name: "First by insertion",
            position: 1,
            createdAt: "2024-04-02T09:00:00.000Z",
          },
        ],
        notes: [],
        completed: [],
      } satisfies AppState);
    } finally {
      await app.close();
    }
  });

  it("returns the first-run shape on a fresh empty DB", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });
    } finally {
      await app.close();
    }
  });
});

// The exact wire JSON, written out field by field so any drift in the SQL
// ordering or the snake_case→camelCase mapping fails loudly.
const expectedState: AppState = {
  activeStackId: "s3",
  stacks: [
    { id: "s2", name: "Groceries", position: 1, createdAt: "2024-01-02T09:00:00.000Z" },
    { id: "s3", name: "Home", position: 2, createdAt: "2024-01-03T09:00:00.000Z" },
    { id: "s1", name: "Work", position: 3, createdAt: "2024-01-01T09:00:00.000Z" },
  ],
  notes: [
    // Notes grouped by drawer (Groceries, Home, Work — stacks.position ASC,
    // NOT id order), top-first within each stack.
    {
      id: "n4",
      stackId: "s2",
      text: "oat milk",
      position: 1,
      createdAt: "2024-02-03T10:00:00.000Z",
    },
    {
      id: "n5",
      stackId: "s3",
      text: "water the plants",
      position: 1,
      createdAt: "2024-02-04T10:00:00.000Z",
    },
    {
      id: "n2",
      stackId: "s1",
      text: "email Lee",
      position: 1,
      createdAt: "2024-01-31T10:00:00.000Z",
    },
    {
      id: "n1",
      stackId: "s1",
      text: "write the shelf docs",
      position: 2,
      createdAt: "2024-02-01T10:00:00.000Z",
    },
    {
      id: "n3",
      stackId: "s1",
      text: "book the dentist",
      position: 3,
      createdAt: "2024-02-02T10:00:00.000Z",
    },
  ],
  completed: [
    // Same completed_at as c3 — id ASC tie-break puts c4 after c3 even though
    // c4 was inserted first (rowid order alone would say c4, c3).
    {
      id: "c3",
      text: "call the bank",
      stackId: "s1",
      stackName: "Work",
      createdAt: "2024-01-25T08:00:00.000Z",
      completedAt: "2024-03-03T12:00:00.000Z",
    },
    {
      id: "c4",
      text: "install the mirror",
      stackId: null,
      stackName: "Old Stack",
      createdAt: "2024-01-10T08:00:00.000Z",
      completedAt: "2024-03-03T12:00:00.000Z",
    },
    {
      id: "c2",
      text: "buy desk lamp",
      stackId: "s1",
      stackName: "Work",
      createdAt: "2024-01-20T08:00:00.000Z",
      completedAt: "2024-03-02T12:00:00.000Z",
    },
    {
      id: "c1",
      text: "water the fern",
      stackId: "s2",
      stackName: "Groceries",
      createdAt: "2024-01-15T08:00:00.000Z",
      completedAt: "2024-03-01T12:00:00.000Z",
    },
  ],
};
