import type { DatabaseSync } from "node:sqlite";
import { fastify, type FastifyInstance } from "fastify";
import { getAppState } from "./state.js";
import { registerWs } from "./ws.js";
import { registerStackRoutes } from "./stacks.js";
import { registerNoteRoutes } from "./notes.js";

export interface BuildAppOptions {
  /**
   * Open SQLite handle backing every read route. The caller owns the db
   * lifecycle — the app never closes it here (index.ts closes it on shutdown
   * signals, after app.close() drains in-flight requests).
   */
  db: DatabaseSync;
  /** Pino logging on/off. Off by default so tests and CI stay quiet. */
  logger?: boolean;
}

/**
 * App factory. All routes/plugins register here so tests can `buildApp()` and
 * use `app.inject()` without touching the network. The listening process
 * lives in `index.ts`; read data comes from the injected `db` option.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, logger = false } = options;
  const app = fastify({ logger });
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/state", async () => getAppState(db));

  // WS sync (PLAN.md "WebSocket sync", DECISIONS.md §9) registers before the
  // mutation routes so its app-level onSend hook provably applies to every
  // route registered after it: every successful /api mutation broadcasts the
  // exact serialized snapshot it responds with to all connected sockets.
  await registerWs(app, db);

  // Mutations wrap up the stack and note routes with a uniform contract per
  // PLAN.md: every mutation responds with the FRESH FULL snapshot from
  // getAppState — 201 on create, 200 otherwise — so the client renders server
  // truth, and that same serialized payload is what T12's WS broadcast
  // delivers to every other socket (via registerWs's onSend hook above).
  registerStackRoutes(app, db);
  registerNoteRoutes(app, db);
  return app;
}
