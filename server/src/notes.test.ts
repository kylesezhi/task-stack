import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, Note } from "@task-stack/shared";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

// Integration tests for the T11 note routes, against real file DBs (never
// :memory:), seeded with raw SQL and fixed ISO timestamps so every expected
// snapshot is exact and human-checkable. Done-when clauses map to:
// - ordering invariants after each operation: the "compacts survivors to 1..N"
//   and "shifts exactly" assertions (and the reorder set-equality rejects)
// - complete snapshots the stack name: the denormalization proof test
//   (rename AFTER completing, archive row still shows the old name)
// - reorder rejects stale/missing ids: the group of 400-rejection tests, each
//   also proving nothing was written (before/after GET equality).
// Mutation routes all answer with the fresh full snapshot from getAppState —
// several tests re-prove this by comparing the mutation response to a
// follow-up GET /api/state. Cleanup mirrors stacks.test.ts (tracked opens,
// sidecar-safe rm, never the repo's own server/data.db).
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-notes-"));
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
  createdAt = "2024-02-01T10:00:00.000Z",
): void {
  run(db, "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    stackId,
    text,
    position,
    createdAt,
  ]);
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
 * Canonical note fixture: Work(s1) with a full three-note stack and Home(s2)
 * with one note, active = Work. Every mutation test below can predict the
 * exact snapshot from this plus the operation's compact/shift rule.
 */
function seedWorkHome(db: DatabaseSync): void {
  insertStack(db, "s1", "Work", 1, "2024-01-01T09:00:00.000Z");
  insertStack(db, "s2", "Home", 2, "2024-01-02T09:00:00.000Z");
  insertNote(db, "n1", "s1", "email Lee", 1);
  insertNote(db, "n2", "s1", "write the shelf docs", 2, "2024-02-02T10:00:00.000Z");
  insertNote(db, "n3", "s1", "call the dentist", 3, "2024-02-03T10:00:00.000Z");
  insertNote(db, "n4", "s2", "water the plants", 1);
  setActive(db, "s1");
}

/** Exactly what the seeded fixture looks like before any route runs. */
const note1 = {
  id: "n1",
  stackId: "s1",
  text: "email Lee",
  position: 1,
  createdAt: "2024-02-01T10:00:00.000Z",
} satisfies Note;

const note3 = {
  id: "n3",
  stackId: "s1",
  text: "call the dentist",
  position: 3,
  createdAt: "2024-02-03T10:00:00.000Z",
} satisfies Note;

const note4 = {
  id: "n4",
  stackId: "s2",
  text: "water the plants",
  position: 1,
  createdAt: "2024-02-01T10:00:00.000Z",
} satisfies Note;

const seededState = {
  activeStackId: "s1",
  stacks: [
    { id: "s1", name: "Work", position: 1, createdAt: "2024-01-01T09:00:00.000Z" },
    { id: "s2", name: "Home", position: 2, createdAt: "2024-01-02T09:00:00.000Z" },
  ],
  notes: [
    note1,
    {
      id: "n2",
      stackId: "s1",
      text: "write the shelf docs",
      position: 2,
      createdAt: "2024-02-02T10:00:00.000Z",
    },
    note3,
    note4,
  ],
  completed: [],
} satisfies AppState;

// note1/note3/note4 above double as undefined-free aliases for the exact
// snapshot assertions (indexing AppState.notes yields `Note | undefined`
// under noUncheckedIndexedAccess).

/** A single-scoped stack, active, with zero notes — for push/reorder no-ops. */
function seedEmptyStack(db: DatabaseSync): void {
  insertStack(db, "s1", "Work", 1, "2024-01-01T09:00:00.000Z");
  setActive(db, "s1");
}

const emptyState = {
  activeStackId: "s1",
  stacks: [{ id: "s1", name: "Work", position: 1, createdAt: "2024-01-01T09:00:00.000Z" }],
  notes: [],
  completed: [],
} satisfies AppState;

describe("POST /api/stacks/:id/notes", () => {
  it("pushes onto an empty stack at position 1, returns 201 + fresh snapshot", async () => {
    const db = trackedOpen(tempDbPath());
    seedEmptyStack(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "first crumb" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as AppState;
      // Generated server-side; must round-trip as canonical ISO-8601 UTC.
      const [newNote] = body.notes;
      expect(newNote?.stackId).toBe("s1");
      expect(newNote?.text).toBe("first crumb");
      expect(newNote?.position).toBe(1);
      expect(Number.isNaN(Date.parse(newNote?.createdAt ?? ""))).toBe(false);
      expect(body.notes).toHaveLength(1);
      expect(body.completed).toEqual([]);
      // 201 on entity creation, mirroring stack-create.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("pushes onto a populated stack at position 1 and shifts survivors exactly +1", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "fresh on top" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as AppState;
      const [newNote, ...rest] = body.notes;
      expect(rest).toEqual([
        {
          id: "n1",
          stackId: "s1",
          text: "email Lee",
          position: 2,
          createdAt: "2024-02-01T10:00:00.000Z",
        },
        {
          id: "n2",
          stackId: "s1",
          text: "write the shelf docs",
          position: 3,
          createdAt: "2024-02-02T10:00:00.000Z",
        },
        {
          id: "n3",
          stackId: "s1",
          text: "call the dentist",
          position: 4,
          createdAt: "2024-02-03T10:00:00.000Z",
        },
        {
          id: "n4",
          stackId: "s2",
          text: "water the plants",
          // Other stacks' positions are INVARIANT — the shift must be scoped.
          position: 1,
          createdAt: "2024-02-01T10:00:00.000Z",
        },
      ] satisfies AppState["notes"]);
      expect(newNote?.position).toBe(1);
      expect(newNote?.text).toBe("fresh on top");
      expect(newNote?.id).not.toBe("n1");
      expect(body.stacks).toEqual(seededState.stacks);
      expect(body.activeStackId).toBe("s1");
      expect(body.completed).toEqual([]);
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("pushing to a non-active stack leaves the active-stack pointer untouched", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db); // active = Work (s1)
    const app = await buildApp({ db });
    try {
      // Push to Home while Work is active.
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s2/notes",
        payload: { text: "tonight" },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as AppState).activeStackId).toBe("s1");
    } finally {
      await app.close();
    }
  });

  it("trims pushed text before it lands", async () => {
    const db = trackedOpen(tempDbPath());
    seedEmptyStack(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "  buy milk  " },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as AppState).notes[0]?.text).toBe("buy milk");
    } finally {
      await app.close();
    }
  });

  it("rejects an empty text with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects a whitespace-only text with 400 and writes nothing (trim runs before the length checks)", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "   " },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects text over 280 characters with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "x".repeat(281) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects an unknown key with 400 (strictObject) and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/s1/notes",
        payload: { text: "hello", priority: 1 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown stack id and leaves everything untouched", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "POST",
        url: "/api/stacks/ghost/notes",
        payload: { text: "ghost crumb" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Stack not found" });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });
});

describe("PATCH /api/notes/:id", () => {
  it("edits the note's text and nothing else", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notes/n2",
        payload: { text: "shelf docs, take two" },
      });
      expect(res.statusCode).toBe(200);
      // Byte-identical except n2.text: positions, other notes, stacks,
      // active pointer, completed — all untouched by a text-only edit.
      expect(res.json()).toEqual({
        ...seededState,
        notes: [
          note1,
          {
            id: "n2",
            stackId: "s1",
            text: "shelf docs, take two",
            position: 2,
            createdAt: "2024-02-02T10:00:00.000Z",
          },
          note3,
          note4,
        ],
      } satisfies AppState);
      // Same body a follow-up GET returns: response === server state.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("trims edited text", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notes/n1",
        payload: { text: "  email Lee  " },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as AppState).notes[0]?.text).toBe("email Lee");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid bodies (empty text) with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notes/n1",
        payload: { text: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects invalid bodies (wrong shape) with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notes/n1",
        payload: { text: "ok", extra: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty("error");
      const res2 = await app.inject({ method: "PATCH", url: "/api/notes/n1", payload: {} });
      expect(res2.statusCode).toBe(400);
      expect(res2.json()).toHaveProperty("error");
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown note id", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notes/ghost",
        payload: { text: "boo" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Note not found" });
    } finally {
      await app.close();
    }
  });
});

describe("DELETE /api/notes/:id (toss)", () => {
  it("tosses the top note; the next note becomes position 1", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/notes/n1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ...seededState,
        notes: [
          {
            id: "n2",
            stackId: "s1",
            text: "write the shelf docs",
            position: 1,
            createdAt: "2024-02-02T10:00:00.000Z",
          },
          {
            id: "n3",
            stackId: "s1",
            text: "call the dentist",
            position: 2,
            createdAt: "2024-02-03T10:00:00.000Z",
          },
          note4,
        ],
      } satisfies AppState);
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("tosses a MIDDLE note and survivors compact to exactly the contiguous 1..N — the adjudicated invariant", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "DELETE", url: "/api/notes/n2" });
      expect(res.statusCode).toBe(200);
      // No drawer-style gap: notes have no append-to-bottom, so the hole
      // would never heal — removal must slide everything below down instead.
      expect((res.json() as AppState).notes.map((note) => [note.id, note.position])).toEqual([
        ["n1", 1],
        ["n3", 2],
        ["n4", 1],
      ]);
    } finally {
      await app.close();
    }
  });

  it("tosses the last remaining note of a stack — the stack is empty, and NO archive row appears", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      // Build a one-note stack via the API (create the stack first) so this
      // test exercises create → push → toss end to end on the same note.
      const created = await app.inject({
        method: "POST",
        url: "/api/stacks",
        payload: { name: "Work" },
      });
      expect(created.statusCode).toBe(201);
      const stackId = (created.json() as AppState).activeStackId;
      expect(stackId).toBeTypeOf("string");
      const pushed = await app.inject({
        method: "POST",
        url: `/api/stacks/${stackId}/notes`,
        payload: { text: "only crumb" },
      });
      expect(pushed.statusCode).toBe(201);
      const noteId = (pushed.json() as AppState).notes[0]?.id;
      expect(noteId).toBeTypeOf("string");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/notes/${noteId}`,
      });
      expect(res.statusCode).toBe(200);
      // Toss is NOT completion (DECISIONS.md §4): no credit for throwing
      // paper away — the archive must stay empty.
      expect((res.json() as AppState).completed).toEqual([]);
      expect((res.json() as AppState).notes).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown id and for an id already tossed, writing nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const ghost = await app.inject({ method: "DELETE", url: "/api/notes/ghost" });
      expect(ghost.statusCode).toBe(404);
      expect(ghost.json()).toEqual({ error: "Note not found" });

      await app.inject({ method: "DELETE", url: "/api/notes/n1" });
      const again = await app.inject({ method: "DELETE", url: "/api/notes/n1" });
      expect(again.statusCode).toBe(404);
      expect(again.json()).toEqual({ error: "Note not found" });
      // Second toss wrote nothing: exactly one note left the table.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect((state.json() as AppState).notes.map((note) => note.id)).toEqual(["n2", "n3", "n4"]);
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/notes/:id/complete", () => {
  it("moves the TOP note to completed — same id, createdAt preserved, stackName snapshotted — and compacts", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "POST", url: "/api/notes/n1/complete" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as AppState;

      const [archived, ...completedRest] = body.completed;
      expect(completedRest).toEqual([]);
      expect(archived?.id).toBe("n1"); // MOVE, not delete+create: id survives
      expect(archived?.text).toBe("email Lee");
      expect(archived?.stackId).toBe("s1");
      expect(archived?.stackName).toBe("Work"); // snapshotted from the stack row
      expect(archived?.createdAt).toBe("2024-02-01T10:00:00.000Z"); // preserved
      // Server-generated; canonical ISO and after the note's own birth.
      expect(archived?.completedAt).toBeTypeOf("string");
      const parsed = Date.parse(archived?.completedAt ?? "");
      expect(Number.isNaN(parsed)).toBe(false);
      expect(parsed).toBeGreaterThanOrEqual(Date.parse("2024-02-01T10:00:00.000Z"));

      // Survivors compact: n2 takes slot 1, n3 slot 2.
      expect(body.notes.map((note) => [note.id, note.position])).toEqual([
        ["n2", 1],
        ["n3", 2],
        ["n4", 1],
      ]);
      expect(body.notes.some((note) => note.id === "n1")).toBe(false);
      // Same body a follow-up GET returns: response === server state.
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(res.json()).toEqual(state.json());
    } finally {
      await app.close();
    }
  });

  it("DENORMALIZATION PROOF: renaming the stack after completing does not rewrite the archive row", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const done = await app.inject({ method: "POST", url: "/api/notes/n1/complete" });
      expect(done.statusCode).toBe(200);

      const renamed = await app.inject({
        method: "PATCH",
        url: "/api/stacks/s1",
        payload: { name: "Deep Work" },
      });
      expect(renamed.statusCode).toBe(200);

      const state = await app.inject({ method: "GET", url: "/api/state" });
      const [archived] = (state.json() as AppState).completed;
      // The name was frozen at completion time — the later rename may update
      // stacks but never leaks back into completed_notes.stack_name.
      expect(archived?.stackName).toBe("Work");
      expect(renamed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("orders two completions NEWEST FIRST in the snapshot", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const first = await app.inject({ method: "POST", url: "/api/notes/n1/complete" });
      expect(first.statusCode).toBe(200);
      // The snapshot sorts completed by completedAt DESC — two completions in
      // the same millisecond would tie and fall back to the id tie-break, so
      // guarantee distinct completedAt values with a breath between the two
      // requests rather than depending on clock granularity.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = await app.inject({ method: "POST", url: "/api/notes/n2/complete" });
      expect(second.statusCode).toBe(200);

      const state = await app.inject({ method: "GET", url: "/api/state" });
      const body = state.json() as AppState;
      expect(body.completed.map((note) => [note.id, note.completedAt])).toEqual([
        ["n2", expect.any(String)],
        ["n1", expect.any(String)],
      ]);
      // The newest one is genuinely newer (not just flipped by the tie-break).
      expect(Date.parse(body.completed[1]?.completedAt ?? "0")).toBeLessThan(
        Date.parse(body.completed[0]?.completedAt ?? ""),
      );
    } finally {
      await app.close();
    }
  });

  it("completes a MIDDLE note (the API is by-id; top-only is a client rule) and compacts", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "POST", url: "/api/notes/n2/complete" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as AppState;
      expect(body.completed.map((note) => note.id)).toEqual(["n2"]);
      expect(body.notes.map((note) => [note.id, note.position])).toEqual([
        ["n1", 1],
        ["n3", 2],
        ["n4", 1],
      ]);
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown note id", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "POST", url: "/api/notes/ghost/complete" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Note not found" });
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect((state.json() as AppState).completed).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("survives a close/reopen cycle — the transaction committed to disk", async () => {
    const path = tempDbPath();
    const db = trackedOpen(path);
    seedWorkHome(db);
    const app = await buildApp({ db });
    let afterComplete: AppState;
    try {
      const res = await app.inject({ method: "POST", url: "/api/notes/n1/complete" });
      expect(res.statusCode).toBe(200);
      afterComplete = res.json() as AppState;
    } finally {
      await app.close();
      db.close();
    }

    // Reopen the SAME file and prove the disk state matches what the API said
    // (an uncommitted or silently lost transaction would show up here).
    const reopened = trackedOpen(path);
    const reopenedApp = await buildApp({ db: reopened });
    try {
      const state = await reopenedApp.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual(afterComplete);
    } finally {
      await reopenedApp.close();
    }
  });
});

describe("PUT /api/stacks/:id/notes/order", () => {
  it("reverses a 3-note stack — sent order becomes positions 1..N, exactly", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n3", "n2", "n1"] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ...seededState,
        notes: [
          {
            id: "n3",
            stackId: "s1",
            text: "call the dentist",
            position: 1,
            createdAt: "2024-02-03T10:00:00.000Z",
          },
          {
            id: "n2",
            stackId: "s1",
            text: "write the shelf docs",
            position: 2,
            createdAt: "2024-02-02T10:00:00.000Z",
          },
          {
            id: "n1",
            stackId: "s1",
            text: "email Lee",
            position: 3,
            createdAt: "2024-02-01T10:00:00.000Z",
          },
          note4,
        ],
      } satisfies AppState);
      // The rewrite persists (a borrow-only read would flip back on next GET).
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.json()).toEqual(res.json());
    } finally {
      await app.close();
    }
  });

  it("accepts a same-order submit as a valid no-op", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n1", "n2", "n3"] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(before.json());
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("accepts [] on an EMPTY stack as a 200 no-op", async () => {
    const db = trackedOpen(tempDbPath());
    seedEmptyStack(db);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: [] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(emptyState);
    } finally {
      await app.close();
    }
  });

  it("rejects [] on a NON-EMPTY stack with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: [] },
      });
      expect(res.statusCode).toBe(400);
      // The rewrite would have emptied the stack — proving it didn't is the
      // follow-up GET.
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects a SUBSET (one id missing) with a descriptive 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n1", "n3"] },
      });
      expect(res.statusCode).toBe(400);
      // Missing n2 — the message names both the id and the defect.
      expect(res.json()).toEqual({ error: 'noteIds is missing id "n2" (a note of this stack)' });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects an UNKNOWN/stale id with a descriptive 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n1", "stale", "n2"] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'noteIds contains unknown id "stale" (not a note of this stack)',
      });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects an id belonging to the OTHER stack with 400 and writes nothing", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      // n4 lives on Home — sneaking it into Work's order is a stale/wrong
      // set (if it were accepted, n4's stack_id wouldn't even change).
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n1", "n4", "n2", "n3"] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'noteIds contains unknown id "n4" (not a note of this stack)',
      });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("rejects duplicate ids with 400 at the schema level", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        payload: { noteIds: ["n1", "n2", "n2"] },
      });
      expect(res.statusCode).toBe(400);
      // The schema's own refine message — set-equality below would miss this
      // (duplicates collapse under new Set()), which is why the schema gates.
      expect(res.json()).toEqual({ error: "noteIds must not contain duplicates" });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });

  it("404s for an unknown stack id", async () => {
    const db = trackedOpen(tempDbPath());
    seedWorkHome(db);
    const app = await buildApp({ db });
    try {
      const before = await app.inject({ method: "GET", url: "/api/state" });
      const res = await app.inject({
        method: "PUT",
        url: "/api/stacks/ghost/notes/order",
        payload: { noteIds: [] },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Stack not found" });
      const after = await app.inject({ method: "GET", url: "/api/state" });
      expect(after.json()).toEqual(before.json());
    } finally {
      await app.close();
    }
  });
});
