/**
 * Zod schemas for every API request body (PLAN.md — Fastify routes under /api).
 *
 * Lives in `shared` (not `server`) so web forms can reuse the same closing
 * rules and the same limits for `maxlength` attributes; client and server
 * ship together, so these schemas are the single expression of what a valid
 * body looks like. Schema objects are `strictObject`: an unknown key is a
 * client/server wiring bug, and we want it loud instead of silently stripped.
 */
import { z } from "zod";

/**
 * Maximum stack name length, after trimming. Application UIs are single-line
 * and DECISIONS.md §5 keeps content "plain text, title-length, like a real
 * sticky note"; 80 is a generous judgment call, trivially raised later.
 * Exported so web forms can mirror it in `maxlength`.
 */
export const STACK_NAME_MAX_LENGTH = 80;

/**
 * Maximum note text length, after trimming — same reasoning as
 * STACK_NAME_MAX_LENGTH (DECISIONS.md §5). Exported for web `maxlength`.
 */
export const NOTE_TEXT_MAX_LENGTH = 280;

/**
 * `trim()` is registered ahead of the length checks, so it runs BEFORE they
 * evaluate: whitespace-only input fails the emptiness check, and the parse
 * result carries the trimmed value. Stack name rule, shared by create and
 * update-patch.
 */
const stackNameSchema = z.string().trim().min(1).max(STACK_NAME_MAX_LENGTH);

/** Note text rule, shared by push-note and edit-note. */
const noteTextSchema = z.string().trim().min(1).max(NOTE_TEXT_MAX_LENGTH);

/**
 * Drawer/stack position: 1-based ascending, no zero or negative (repo-wide
 * semantics — note 1 is the top of a stack; stack 1 is the front of the
 * drawer). Integer check rejects fractions such as 1.5.
 */
const positionSchema = z.number().int().min(1);

/**
 * `POST /api/stacks` — create a stack. Position is assigned server-side.
 */
export const CreateStackSchema = z.strictObject({ name: stackNameSchema });

/**
 * `PATCH /api/stacks/:id` — rename and/or reorder within the drawer. At least
 * one real value must be present: an empty PATCH body is a client bug, and a
 * silent "nothing was patched" no-op would hide it. Present-but-undefined
 * keys count as empty (zod keeps them on the parsed object, so a key-count
 * check would let a no-op patch through); unreachable via JSON, but
 * reachable from in-process callers of `UpdateStackInput`.
 */
export const UpdateStackSchema = z
  .strictObject({
    name: stackNameSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.position !== undefined, {
    error: "PATCH body must contain at least one field (name or position)",
  });

/**
 * Id check for stackId / noteIds elements: rejects blank ids (empty or
 * whitespace-only — anything with a non-whitespace character passes) while
 * deliberately NOT validating uuid format and NOT trimming. The server's
 * existence check is the real id validation (a bogus non-blank id 404s), and
 * rewriting an id via trim could alias two distinct ids or silently fix a
 * client bug that would otherwise be caught by the mismatch.
 */
const idSchema = z.string().regex(/\S/, { error: "id must contain a non-whitespace character" });

/**
 * `PUT /api/active` — select the active stack.
 */
export const SetActiveStackSchema = z.strictObject({ stackId: idSchema });

/**
 * `POST /api/stacks/:id/notes` — push a note onto (the top of) a stack.
 */
export const PushNoteSchema = z.strictObject({ text: noteTextSchema });

/**
 * `PATCH /api/notes/:id` — edit note text. Same rule as push, but a separate
 * schema so the two endpoints can evolve independently.
 */
export const EditNoteSchema = z.strictObject({ text: noteTextSchema });

/**
 * `PUT /api/stacks/:id/notes/order` — full reorder write; the array is the
 * complete id sequence and its indexes become the positions. Duplicates are
 * rejected here because they collapse under a set comparison, so they can
 * pass a naive set-equality check while writing two notes to the same
 * position. An empty array is allowed: a valid full rewrite of an empty
 * stack; id-set equality with the stack's notes is the server's job, not
 * this schema's.
 */
export const ReorderNotesSchema = z.strictObject({
  noteIds: z.array(idSchema).refine((ids) => new Set(ids).size === ids.length, {
    error: "noteIds must not contain duplicates",
  }),
});

export type CreateStackInput = z.infer<typeof CreateStackSchema>;
export type UpdateStackInput = z.infer<typeof UpdateStackSchema>;
export type SetActiveStackInput = z.infer<typeof SetActiveStackSchema>;
export type PushNoteInput = z.infer<typeof PushNoteSchema>;
export type EditNoteInput = z.infer<typeof EditNoteSchema>;
export type ReorderNotesInput = z.infer<typeof ReorderNotesSchema>;
