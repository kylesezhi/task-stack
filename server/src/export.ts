import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { getAppState } from "./state.js";

/**
 * Registers `GET /api/export` — the full JSON dump for backups and data
 * ownership (PLAN.md API table; DECISIONS.md §9 pairs it with the nightly
 * file copy). The payload is exactly what /api/state answers with, plus an
 * `exportedAt` provenance timestamp: a dump indistinguishable from a live
 * read is also indistinguishable from a stale one, and the nightly backup
 * workflow needs to tell them apart.
 *
 * A read route, like /api/state — it never triggers the WS broadcast
 * (ws.ts filters to successful POST/PUT/PATCH/DELETE mutations).
 */
export function registerExportRoute(app: FastifyInstance, db: DatabaseSync): void {
  app.get("/api/export", async () => {
    const state = getAppState(db);
    return { ...state, exportedAt: new Date().toISOString() };
  });
}
