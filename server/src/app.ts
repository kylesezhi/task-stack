import type { DatabaseSync } from "node:sqlite";
import { fastify, type FastifyInstance } from "fastify";
import { getAppState } from "./state.js";
import { registerStackRoutes } from "./stacks.js";

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

  // Mutations wrap up the stack routes with a uniform contract per PLAN.md:
  // every mutation responds with the FRESH FULL snapshot from getAppState —
  // 201 on create, 200 otherwise — so the client renders server truth (and
  // T12's WS broadcast matches what the mutating request returns).
  registerStackRoutes(app, db);
  return app;
}
