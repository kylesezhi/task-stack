/**
 * Core data types for task-stack, shared between server and web.
 *
 * Shapes mirror the SQLite schema in PLAN.md ("Data model"):
 * ids are uuids, timestamps are ISO 8601 strings. Field names use camelCase
 * on the wire (the server maps snake_case columns at the query boundary).
 */

/** A named stack of notes. */
export interface Stack {
  /** uuid */
  id: string;
  name: string;
  /** Drawer order — ascending. */
  position: number;
  /** ISO 8601 */
  createdAt: string;
}

/** A pending note. */
export interface Note {
  /** uuid */
  id: string;
  /** Owning stack. */
  stackId: string;
  /** Plain text, title-length — like a real sticky note. */
  text: string;
  /** 1 = TOP of the stack, increasing downward. */
  position: number;
  /** ISO 8601 */
  createdAt: string;
}

/** A completed (popped) note. Survives deletion of its originating stack. */
export interface CompletedNote {
  /** uuid */
  id: string;
  text: string;
  /** Null once the originating stack has been deleted. */
  stackId: string | null;
  /** Denormalized at completion time so the archive stays readable. */
  stackName: string;
  /** ISO 8601 — when the note was pushed. */
  createdAt: string;
  /** ISO 8601 — when the note was completed. */
  completedAt: string;
}

/**
 * Full server snapshot — the single source of truth clients render
 * (`GET /api/state` and every WS broadcast).
 */
export interface AppState {
  /** The globally active stack, or null when no stacks exist yet (first run). */
  activeStackId: string | null;
  /** All stacks, ordered by `position` ascending (drawer order). */
  stacks: Stack[];
  /** All pending notes across all stacks; within each stack ordered by
   * `position` ascending (1 = top). */
  notes: Note[];
  /** Completed notes, newest first (`completedAt` descending). */
  completed: CompletedNote[];
}
