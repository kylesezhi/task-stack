import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DB_PATH, dbPathFromEnv, openDatabase } from "./db.js";

// Integration test against real files (never :memory:) so WAL mode and
// FK enforcement behave exactly like a running server. Databases and their
// temp dirs are tracked so cleanup also removes the -wal/-shm sidecars, and
// the repo's own server/data.db is never touched.
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function tempDbPath(fileName = "test.db"): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-db-"));
  tempDirs.push(dir);
  return join(dir, fileName);
}

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function closeAll(): void {
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close(); // isOpen guards against double-close in reopen test
  }
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  return rows.map((row) => String(row["name"])).sort();
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row["name"]));
}

afterEach(() => {
  closeAll();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("openDatabase", () => {
  it("creates every table with the exact PLAN.md columns", () => {
    const db = trackedOpen(tempDbPath());

    expect(tableNames(db)).toEqual(["completed_notes", "notes", "settings", "stacks"]);

    // Full column lists per table, order included (PRAGMA table_info order).
    expect(columnNames(db, "stacks")).toEqual(["id", "name", "position", "created_at"]);
    expect(columnNames(db, "notes")).toEqual(["id", "stack_id", "text", "position", "created_at"]);
    expect(columnNames(db, "completed_notes")).toEqual([
      "id",
      "text",
      "stack_id",
      "stack_name",
      "created_at",
      "completed_at",
    ]);
    expect(columnNames(db, "settings")).toEqual(["key", "value"]);
  });

  it("leaves settings empty — seeding is not this task's job", () => {
    const db = trackedOpen(tempDbPath());
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 0 });
  });

  it("opens a file DB in WAL mode with foreign keys on", () => {
    const db = trackedOpen(tempDbPath());

    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("enforces the notes→stacks foreign key for real", () => {
    const db = trackedOpen(tempDbPath());

    // A note pointing at a nonexistent stack must be rejected by SQLite
    // (not merely by the PRAGMA flag being set).
    expect(() =>
      db
        .prepare(
          "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("n1", "no-such-stack", "hello", 1, new Date().toISOString()),
    ).toThrow(/FOREIGN KEY/);

    // With a real stack present the same insert succeeds.
    db.prepare("INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)").run(
      "s1",
      "Work",
      1,
      new Date().toISOString(),
    );
    expect(() =>
      db
        .prepare(
          "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("n2", "s1", "hello again", 1, new Date().toISOString()),
    ).not.toThrow();
  });

  it("reopens the same file idempotently with tables intact", () => {
    const path = tempDbPath();
    trackedOpen(path).close();

    const reopened = openDatabase(path); // must not throw
    openDbs.push(reopened);

    expect(tableNames(reopened)).toEqual(["completed_notes", "notes", "settings", "stacks"]);
  });

  it("creates the parent directory for a nested absolute path", () => {
    // First-boot scenario: DB_PATH points three levels deep into a fresh dir.
    const dir = mkdtempSync(join(tmpdir(), "task-stack-db-"));
    tempDirs.push(dir);
    const nested = join(dir, "missing", "levels", "t.db");

    const db = trackedOpen(nested);
    expect(tableNames(db)).toContain("stacks");
    expect(readdirSync(dirname(nested))).toContain("t.db");
  });
});

describe("db path resolution", () => {
  it("defaults to server/data.db next to this module, not process.cwd()", () => {
    // In dev (tsx) the module sits in server/src/, in prod in server/dist/;
    // one level up is server/ in both. cwd (repo root in vitest) must be
    // irrelevant.
    expect(basename(DEFAULT_DB_PATH)).toBe("data.db");
    expect(basename(dirname(DEFAULT_DB_PATH))).toBe("server");
  });

  it("honors an explicit DB_PATH override", () => {
    expect(dbPathFromEnv({ DB_PATH: "/some/abs/path.db" })).toBe("/some/abs/path.db");
    expect(dbPathFromEnv({ DB_PATH: "relative/choice.db" })).toBe("relative/choice.db");
  });

  it("falls back to the module-relative default without DB_PATH", () => {
    expect(dbPathFromEnv({})).toBe(DEFAULT_DB_PATH);
  });
});
