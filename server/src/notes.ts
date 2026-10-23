import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { EditNoteSchema, PushNoteSchema, ReorderNotesSchema } from "@task-stack/shared";
import { withTransaction } from "./db.js";
import { firstIssueMessage, sendError } from "./errors.js";
import { getAppState } from "./state.js";

/** node:sqlite row shape — all typed conversions are explicit at the boundary. */
type Row = Record<string, number | bigint | string | null | Uint8Array>;

/**
 * Compacts a stack's note positions back to the contiguous 1..N invariant
 * after a note at `deletedPosition` left the stack. Runs INSIDE the caller's
 * transaction — two statements that must land together (delete + renumber).
 *
 * Why compact notes when stack-delete deliberately leaves drawer gaps: the
 * drawer appends at MAX(position)+1, so a gap in drawer positions heals
 * itself on the next create. Notes have no append-to-bottom — push always
 * lands at position 1 after shifting survivors up only if they start below
 * 1... which nothing does once a gap exists. A hole would sit there forever,
 * so removal instead slides everything down: sift through, no crumbs.
 */
function compactBelow(db: DatabaseSync, stackId: string, deletedPosition: number): void {
  db.prepare("UPDATE notes SET position = position - 1 WHERE stack_id = ? AND position > ?").run(
    stackId,
    deletedPosition,
  );
}

/**
 * Registers the note mutation routes (POST push, PATCH edit, DELETE toss,
 * POST complete, PUT reorder). Called from buildApp so tests and the real
 * server share one wiring; the injected db handle is read-only from here —
 * the caller owns lifecycle (index.ts closes it on shutdown).
 *
 * Every mutation responds with the fresh full snapshot from getAppState —
 * never a delta — so clients (REST now, WS broadcast in T12) can't diverge
 * from the database's view of the world.
 */
export function registerNoteRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post<{ Params: { id: string } }>("/api/stacks/:id/notes", async (request, reply) => {
    const parsed = PushNoteSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    const { id } = request.params;
    const stack = db.prepare("SELECT id FROM stacks WHERE id = ?").get(id);
    if (stack === undefined) return sendError(reply, 404, "Stack not found");

    const noteId = randomUUID();
    const createdAt = new Date().toISOString();

    // Shift + insert must land together or a crash between them leaves two
    // position-1 notes on the floor. A single UPDATE shifting every row is
    // safe precisely because (stack_id, position) has NO UNIQUE constraint —
    // the transient duplicate positions mid-transaction would abort under
    // one. (Push never creates gaps — it lands at 1 above a contiguous
    // 1..N — and removals compact, so the invariant holds by construction.)
    // The WHERE is scoped to this stack: an unscoped `UPDATE notes SET
    // position = position + 1` is the classic bug — it would shift every
    // stack's notes out of 1..N in one stroke.
    withTransaction(db, () => {
      db.prepare("UPDATE notes SET position = position + 1 WHERE stack_id = ?").run(id);
      // Note also never touches the active-stack pointer: pushing to a
      // non-active stack must not switch active (unlike stack-create, which
      // activates what it makes).
      db.prepare(
        "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(noteId, id, parsed.data.text, 1, createdAt);
    });

    // 201: push (like stack-create) mints an entity — the one POST here that
    // creates rather than acts on one.
    reply.code(201);
    return getAppState(db);
  });

  app.patch<{ Params: { id: string } }>("/api/notes/:id", async (request, reply) => {
    const parsed = EditNoteSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    const { id } = request.params;
    const note = db.prepare("SELECT id FROM notes WHERE id = ?").get(id);
    if (note === undefined) return sendError(reply, 404, "Note not found");

    // Text-only patch: a single UPDATE — no transaction for one statement
    // (same reasoning as stacks.ts's name-only branch). The schema already
    // trimmed the text, and positions/created_at are untouched by design —
    // editing content must never reorder the stack.
    db.prepare("UPDATE notes SET text = ? WHERE id = ?").run(parsed.data.text, id);

    return getAppState(db);
  });

  app.delete<{ Params: { id: string } }>("/api/notes/:id", async (request, reply) => {
    const { id } = request.params;
    const note = db.prepare("SELECT id, position, stack_id FROM notes WHERE id = ?").get(id);
    if (note === undefined) return sendError(reply, 404, "Note not found");

    withTransaction(db, () => {
      // Hard delete — toss is NOT completion (DECISIONS.md §4: tossed notes
      // never reach the archive; no credit for throwing paper away) and v1
      // has no undo, so there is nowhere for the row to go. No body is
      // expected or validated: the URL is the whole request.
      const stackId = String(note["stack_id"]);
      const deletedPosition = Number(note["position"]);
      db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      // Same transaction: delete without renumber would leave a permanent
      // gap next to positions that are otherwise exactly the contiguous
      // 1..N every client (and state.test.ts) relies on.
      compactBelow(db, stackId, deletedPosition);
    });

    return getAppState(db);
  });

  app.post<{ Params: { id: string } }>("/api/notes/:id/complete", async (request, reply) => {
    // No body expected — complete is an action on an existing resource, the
    // URL id is the whole request. Any payload is ignored, not rejected.
    const { id } = request.params;
    // ONE join instead of two lookups so the denormalized snapshot (the
    // stack's CURRENT name — completed_notes.stack_name is frozen at
    // completion time per the data model) and the existence check in the
    // same place: a note without a stacks row is impossible (FK), so a
    // missing row here cleanly means "no such note".
    const note = db
      .prepare(
        `SELECT notes.id, notes.stack_id, notes.text, notes.position, notes.created_at,
                stacks.name AS stack_name
         FROM notes JOIN stacks ON stacks.id = notes.stack_id
         WHERE notes.id = ?`,
      )
      .get(id);
    if (note === undefined) return sendError(reply, 404, "Note not found");

    const completedAt = new Date().toISOString();

    withTransaction(db, () => {
      // Kept the same uuid: PLAN.md models complete as a row MOVE, not a
      // delete+create. A PK collision with an existing completed row cannot
      // happen — completion is the only route that writes an id borrowed
      // from notes, and push (the only other id minter) mints fresh uuids,
      // so an id departs notes exactly once and completed_notes never held
      // it before.
      //
      // stack_id and stack_name are snapshotted from the CURRENT stack row —
      // later renames must not leak back into the archive (the denormalized
      // name is the point of the column; it also keeps archive rows readable
      // after stack-delete nulls stack_id). created_at is PRESERVED — it
      // describes when the note was written; completed_at is the new fact.
      db.prepare(
        `INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        String(note["id"]),
        String(note["text"]),
        String(note["stack_id"]),
        String(note["stack_name"]),
        String(note["created_at"]),
        completedAt,
      );
      const stackId = String(note["stack_id"]);
      const completedPosition = Number(note["position"]);
      db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      // Not (necessarily) the top note — the API is by-id; the top-only rule
      // is a client (StackView) concern, not a server one. Whatever left,
      // compact, same as toss.
      compactBelow(db, stackId, completedPosition);
    });

    // 200, not 201: complete is an ACTION on an existing resource that moves
    // it — entity creation (and thus 201) is reserved for push and
    // stack-create.
    return getAppState(db);
  });

  app.put<{ Params: { id: string } }>("/api/stacks/:id/notes/order", async (request, reply) => {
    const parsed = ReorderNotesSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    const { id } = request.params;
    const stack = db.prepare("SELECT id FROM stacks WHERE id = ?").get(id);
    if (stack === undefined) return sendError(reply, 404, "Stack not found");

    // Set comparison, not order comparison: the client sends the complete id
    // sequence only, so anything other than exact SET equality is stale
    // state or a wiring bug. Consequences written to nothing.
    const currentIds = new Set(
      db
        .prepare("SELECT id FROM notes WHERE stack_id = ?")
        .all(id)
        .map((row: Row) => String(row["id"])),
    );
    const sentIds = new Set(parsed.data.noteIds);
    for (const sentId of sentIds) {
      if (!currentIds.has(sentId)) {
        return sendError(
          reply,
          400,
          `noteIds contains unknown id "${sentId}" (not a note of this stack)`,
        );
      }
    }
    for (const currentId of currentIds) {
      if (!sentIds.has(currentId)) {
        return sendError(reply, 400, `noteIds is missing id "${currentId}" (a note of this stack)`);
      }
    }

    withTransaction(db, () => {
      // Full rewrite: sent order indexes become positions index+1. One
      // prepared statement reused in a loop — one parse, N runs (same shape
      // as stacks.ts's drawer rewrite). Same-order submits rewrite identical
      // values — an identity write, deliberately a harmless no-op.
      const update = db.prepare("UPDATE notes SET position = ? WHERE id = ?");
      parsed.data.noteIds.forEach((noteId, index) => {
        update.run(index + 1, noteId);
      });
    });

    return getAppState(db);
  });
}
