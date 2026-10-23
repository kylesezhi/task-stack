import type { DatabaseSync } from "node:sqlite";
import type { AppState, CompletedNote, Note, Stack } from "@task-stack/shared";

/**
 * Builds the full server snapshot (`{ activeStackId, stacks, notes, completed }`)
 * in one pass. Deliberately separate from the GET /api/state route so T12's
 * WebSocket broadcast can reuse the exact same output: clients must never see
 * two divergent notions of "the current state".
 *
 * Every ordering rule below carries an id tie-break. Positions and timestamps
 * are not unique, so the tie-breaks are what make the JSON deterministic even
 * across rows sharing a key (tests seed equal completed_at values relying on
 * this — an architect decision).
 */
export function getAppState(db: DatabaseSync): AppState {
  // Drawer order; id as tie-break so equal positions still sort deterministically.
  const stacks = db
    .prepare("SELECT id, name, position, created_at FROM stacks ORDER BY position ASC, id ASC")
    .all()
    .map(toStack);

  // An inner JOIN loses nothing: notes.stack_id is NOT NULL and REFERENCES
  // stacks(id) with foreign_keys ON, so every note has a stacks row. Result
  // reads as drawer-ordered groups, each stack's notes top-first (1 = top).
  // Duplicate (stack, position) pairs are unreachable through the API (push
  // and reorder maintain 1..N per stack), so the final notes.id term is
  // determinism-by-construction for pathological states — no fixture case
  // exercises it. It exists so "every ordering rule carries an id tie-break"
  // holds uniformly.
  const notes = db
    .prepare(
      `SELECT notes.id, notes.stack_id, notes.text, notes.position, notes.created_at
       FROM notes JOIN stacks ON stacks.id = notes.stack_id
       ORDER BY stacks.position ASC, stacks.id ASC, notes.position ASC, notes.id ASC`,
    )
    .all()
    .map(toNote);

  // Newest first; id ASC tie-break for notes completed in the same instant
  // (completed_at collisions are expected — same-second completions).
  const completed = db
    .prepare(
      `SELECT id, text, stack_id, stack_name, created_at, completed_at
       FROM completed_notes
       ORDER BY completed_at DESC, id ASC`,
    )
    .all()
    .map(toCompletedNote);

  const activeRow = db.prepare("SELECT value FROM settings WHERE key = 'active_stack_id'").get();
  // Absent row → null (first run). A dangling id pointing at a deleted stack is
  // not cleaned up here — that is T10's (stack DELETE) responsibility.
  const activeStackId = activeRow === undefined ? null : String(activeRow["value"]);

  return { activeStackId, stacks, notes, completed };
}

/** node:sqlite row shape — all typed conversions are explicit at the boundary. */
type Row = Record<string, number | bigint | string | null | Uint8Array>;

// snake_case columns → camelCase wire types (per @task-stack/shared). The
// schema declares NOT NULL for every mapped column, so the String/Number
// coercions are safe: SQLite could only hand back null with a schema change.
function toStack(row: Row): Stack {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    position: Number(row["position"]),
    createdAt: String(row["created_at"]),
  };
}

function toNote(row: Row): Note {
  return {
    id: String(row["id"]),
    stackId: String(row["stack_id"]),
    text: String(row["text"]),
    position: Number(row["position"]),
    createdAt: String(row["created_at"]),
  };
}

function toCompletedNote(row: Row): CompletedNote {
  return {
    id: String(row["id"]),
    text: String(row["text"]),
    stackId: row["stack_id"] === null ? null : String(row["stack_id"]),
    stackName: String(row["stack_name"]),
    createdAt: String(row["created_at"]),
    completedAt: String(row["completed_at"]),
  };
}
