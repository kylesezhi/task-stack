import type { FastifyReply } from "fastify";

/**
 * The error contract shared by every route in the repo (stacks, notes, and
 * later route modules follow suit): a plain `{ error: "<human-readable
 * message>" }` body with a 400 (validation: the first zod issue's message,
 * verbatim) or 404 status. Fastify's not-found handler and JSON-schema
 * validation stay untouched — bodies are validated with manual `safeParse` so
 * shared/ remains the single source of the rules.
 */
export function sendError(reply: FastifyReply, status: 400 | 404, message: string): FastifyReply {
  return reply.code(status).send({ error: message });
}

/** A failed safeParse always carries ≥1 issue; only an empty `issues` array —
 * structurally impossible for zod — falls back to a generic message. */
export function firstIssueMessage(issues: readonly { message: string }[]): string {
  const first = issues[0];
  return first === undefined ? "Invalid request body" : first.message;
}
