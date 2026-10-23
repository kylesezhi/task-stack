import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { CreateStackSchema, SetActiveStackSchema, UpdateStackSchema } from "@task-stack/shared";
import { withTransaction } from "./db.js";
import { firstIssueMessage, sendError } from "./errors.js";
import { getAppState } from "./state.js";

/** Settings row key that names the globally active stack (PLAN.md data model). */
const ACTIVE_STACK_ID_KEY = "active_stack_id";

/** node:sqlite row shape — all typed conversions are explicit at the boundary. */
type Row = Record<string, number | bigint | string | null | Uint8Array>;

/**
 * Upserts the active-stack pointer. A single statement (atomic on its own) —
 * the transaction around it, when there is one, belongs to the caller so that
 * create/delete pair it with the stack write that justifies it.
 */
function setActiveStack(db: DatabaseSync, stackId: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(ACTIVE_STACK_ID_KEY, stackId);
}

/** Stacks in drawer order — the same ORDER BY getAppState uses (id ASC
 * tie-break), so moves computed here match what clients see. */
function drawerOrder(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT id FROM stacks ORDER BY position ASC, id ASC")
    .all()
    .map((row: Row) => String(row["id"]));
}

/**
 * Registers the stack mutation routes (POST create, PATCH rename/reorder,
 * DELETE, PUT active). Called from buildApp so tests and the real server share
 * one wiring; the injected db handle is read-only from here — the caller owns
 * lifecycle (index.ts closes it on shutdown).
 *
 * Every mutation responds with the fresh full snapshot from getAppState —
 * never a delta — so clients (REST now, WS broadcast in T12) can't diverge
 * from the database's view of the world.
 */
export function registerStackRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post("/api/stacks", async (request, reply) => {
    const parsed = CreateStackSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Append + activate must land together: a stack that exists without being
    // active (on a no-stacks-yet DB) would leave activeStackId null and break
    // the "something is always selected after a mutation" client invariant.
    withTransaction(db, () => {
      // Append to the drawer end: after the current last position. COALESCE
      // makes the empty-drawer case position 1; an aggregate SELECT always
      // yields exactly one row, so the undefined guard is only for types.
      const maxRow = db.prepare("SELECT COALESCE(MAX(position), 0) AS max FROM stacks").get();
      const nextPosition = maxRow === undefined ? 1 : Number(maxRow["max"]) + 1;

      db.prepare("INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)").run(
        id,
        parsed.data.name,
        nextPosition,
        createdAt,
      );
      setActiveStack(db, id);
    });

    reply.code(201);
    return getAppState(db);
  });

  app.patch<{ Params: { id: string } }>("/api/stacks/:id", async (request, reply) => {
    const parsed = UpdateStackSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    const { id } = request.params;
    const stack = db.prepare("SELECT id FROM stacks WHERE id = ?").get(id);
    if (stack === undefined) return sendError(reply, 404, "Stack not found");

    // The schema's refine guarantees at least one field, so the name-only and
    // position branches below cover every valid body.
    const body = parsed.data;

    if (body.position === undefined) {
      // Name-only patch: a single UPDATE — no transaction for one statement.
      if (body.name !== undefined) {
        db.prepare("UPDATE stacks SET name = ? WHERE id = ?").run(body.name, id);
      }
      return getAppState(db);
    }

    const order = drawerOrder(db);
    // Approved decision: an out-of-range position rejects rather than clamps.
    // Clients derive positions from the drawer length they last saw, so a
    // larger number is stale state or a wiring bug — reject it loud instead
    // of silently clamping (which would hide the divergence).
    if (body.position > order.length) {
      return sendError(
        reply,
        400,
        `position ${body.position} is out of range (drawer has ${order.length} stacks)`,
      );
    }

    // Insert-at move semantics: remove the stack from the drawer, insert it at
    // 1-based `position`, then rewrite every position 1..N compactly. When the
    // requested position equals the current one this is an identity write
    // (same rows, same values) — a deliberate harmless no-op.
    const reordered = order.filter((stackId) => stackId !== id);
    reordered.splice(body.position - 1, 0, id);

    withTransaction(db, () => {
      if (body.name !== undefined) {
        db.prepare("UPDATE stacks SET name = ? WHERE id = ?").run(body.name, id);
      }
      const update = db.prepare("UPDATE stacks SET position = ? WHERE id = ?");
      reordered.forEach((stackId, index) => {
        update.run(index + 1, stackId);
      });
    });

    return getAppState(db);
  });

  app.delete<{ Params: { id: string } }>("/api/stacks/:id", async (request, reply) => {
    const { id } = request.params;
    const stack = db.prepare("SELECT id FROM stacks WHERE id = ?").get(id);
    if (stack === undefined) return sendError(reply, 404, "Stack not found");

    // Read the active pointer BEFORE deleting; the if below compares against
    // the stack's id, not against "whatever settings says after the delete".
    const activeRow = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(ACTIVE_STACK_ID_KEY);
    const activeId = activeRow === undefined ? null : String(activeRow["value"]);

    withTransaction(db, () => {
      // Order matters for the FK: notes.stack_id REFERENCES stacks(id) and
      // foreign_keys=ON, so pending notes must die before the stack row, or
      // the parent delete would abort. completed_notes deliberately has NO
      // FK — its rows persist instead, dropping stack_id to NULL; the already
      // denormalized stack_name keeps the archive readable after deletion.
      db.prepare("DELETE FROM notes WHERE stack_id = ?").run(id);
      db.prepare("UPDATE completed_notes SET stack_id = NULL WHERE stack_id = ?").run(id);
      db.prepare("DELETE FROM stacks WHERE id = ?").run(id);

      // Never leave a dangling active_stack_id: switching to the first
      // survivor in drawer order keeps "something is selected" true; with no
      // stacks left, deleting the settings row is the null state —
      // settings.value is NOT NULL, so a null value is impossible and
      // getAppState maps an absent row to null.
      if (activeId === id) {
        const survivor = db
          .prepare("SELECT id FROM stacks ORDER BY position ASC, id ASC LIMIT 1")
          .get();
        if (survivor === undefined) {
          db.prepare("DELETE FROM settings WHERE key = ?").run(ACTIVE_STACK_ID_KEY);
        } else {
          setActiveStack(db, String(survivor["id"]));
        }
      }
    });

    return getAppState(db);
  });

  app.put("/api/active", async (request, reply) => {
    const parsed = SetActiveStackSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, firstIssueMessage(parsed.error.issues));

    // Existence is the real id validation (the schema intentionally accepts
    // any non-blank string): a bogus but well-formed id is a 404, not a 400.
    const stack = db.prepare("SELECT id FROM stacks WHERE id = ?").get(parsed.data.stackId);
    if (stack === undefined) return sendError(reply, 404, "Stack not found");

    setActiveStack(db, parsed.data.stackId);
    return getAppState(db);
  });
}
