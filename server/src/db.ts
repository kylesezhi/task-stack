import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Default DB lives at server/data.db, resolved relative to this module's file
// location — NOT process.cwd(). In dev (tsx) this module sits in server/src/,
// in prod (node server/dist/index.js) in server/dist/, so stepping one level
// up lands on server/ either way. That keeps `pnpm --filter server dev` (cwd
// server/) and `node server/dist/index.js` (cwd repo root) on the same file.
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = join(dirname(moduleDir), "data.db");

/** Environment subset read for DB path resolution (injectable for tests). */
export interface DbPathEnv {
  DB_PATH?: string;
}

/**
 * Resolves the DB file path: explicit DB_PATH wins (absolute or cwd-relative —
 * used as given), else the module-relative default. Pure so tests can check
 * resolution without mutating the real environment.
 */
export function dbPathFromEnv(env: DbPathEnv = process.env): string {
  return env.DB_PATH ?? DEFAULT_DB_PATH;
}

/** Schema per PLAN.md "Data model" — CREATE ... IF NOT EXISTS so reopening an
 * existing DB is a no-op and first boot is idempotent. Never seed: settings
 * stays empty until stack creation (T10) writes active_stack_id. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS stacks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  stack_id    TEXT NOT NULL REFERENCES stacks(id),
  text        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS completed_notes (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  stack_id     TEXT,
  stack_name   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Opens (creating if absent) the SQLite database at `path`, applies the
 * pragmas and creates the v1 schema. Omitted path → DB_PATH env, else
 * server/data.db next to this module. Returns the raw DatabaseSync — query/
 * CRUD helpers live in later tasks, this is schema + pragmas + lifecycle +
 * withTransaction only.
 */
export function openDatabase(path?: string): DatabaseSync {
  const resolvedPath = path ?? dbPathFromEnv();

  // The parent dir may not exist (Docker volume mounted on first boot); SQLite
  // would otherwise fail with "unable to open database file".
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);

  if (resolvedPath !== ":memory:") {
    // WAL: readers don't block the writer and a crash can't corrupt a
    // partially-written page the way the rollback journal can. journal_mode
    // is persisted, but we still run + VERIFY it every open: a read-only
    // mount or exotic filesystem would silently keep the old mode — loud
    // misconfiguration beats silent corruption.
    const row = db.prepare("PRAGMA journal_mode = WAL").get();
    if (!row || row["journal_mode"] !== "wal") {
      db.close();
      throw new Error(
        `Failed to enable WAL journal mode on ${resolvedPath} (got ${JSON.stringify(row?.["journal_mode"] ?? null)})`,
      );
    }
  }

  // foreign_keys is per-connection in SQLite (never persisted in the file), so
  // it MUST run on every open. Without it, notes.row's REFERENCES stacks(id)
  // is decorative and orphaned notes become possible. Verify too...
  db.exec("PRAGMA foreign_keys = ON");
  const fk = db.prepare("PRAGMA foreign_keys").get();
  if (!fk || fk["foreign_keys"] !== 1) {
    db.close();
    throw new Error("Failed to enable PRAGMA foreign_keys");
  }

  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Runs `fn` inside one SQLite transaction. node:sqlite's DatabaseSync has no
 * transaction API — BEGIN/COMMIT/ROLLBACK via exec is the way. fn MUST be
 * synchronous: one withTransaction covers a fixed, fully-executed statement
 * block. An async fn would escape the COMMIT (below), so a thenable result is
 * detected and rejected loudly instead of losing atomicity silently. Sound
 * because every statement between BEGIN and COMMIT is synchronous: an
 * exception can only leave the transaction open if ROLLBACK itself throws,
 * and the most common reason for that (transaction already terminated) is
 * exactly the case where nothing is left open. The original error is
 * re-thrown either way.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    if (
      result !== undefined &&
      result !== null &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      // Statements already ran inside the transaction — undo them, then fail
      // loudly: an async callback would escape the COMMIT below, and its
      // awaited DB work would land OUTSIDE the (already committed) block.
      db.exec("ROLLBACK");
      throw new TypeError(
        "withTransaction requires a synchronous callback: an async callback would " +
          "escape the COMMIT and its DB work would land outside the transaction",
      );
    }
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Nothing to roll back (or the connection is already broken) —
      // re-throw the original error, which is the informative one.
    }
    throw err;
  }
}
