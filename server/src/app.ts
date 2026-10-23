import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fastify, type FastifyInstance } from "fastify";
import { registerExportRoute } from "./export.js";
import { getAppState } from "./state.js";
import { registerStatic, webDistPathFromEnv } from "./static.js";
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
  /**
   * Web dist root to serve at `/` (T14 production mode). Explicit wins —
   * tests inject fixture dirs, and T36's Docker image points at wherever
   * web/dist lands inside the image (the WEB_DIST_PATH env does the same
   * job for ops). Unset → WEB_DIST_PATH env, else the module-relative
   * default (static.ts) — and when that default directory does not exist
   * (an API-only checkout, no `pnpm -r build` yet) static serving is
   * skipped entirely: the API still boots, and the dev-time UI is vite's
   * own server anyway.
   */
  webDist?: string;
}

/**
 * App factory. All routes/plugins register here so tests can `buildApp()` and
 * use `app.inject()` without touching the network. The listening process
 * lives in `index.ts`; read data comes from the injected `db` option.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, logger = false } = options;
  const app = fastify({ logger });

  // Open-server hygiene (DECISIONS.md §9): every response declares
  // X-Robots-Tag: noindex so a crawler that stumbles onto the URL indexes
  // nothing. The deployment is intentionally unauthenticated (§9 — single
  // user, open to anyone holding the URL); the URL staying out of search
  // engines is part of that deal. Registered before ANY route — Fastify
  // app-level hooks reliably cover routes registered after them, so first
  // thing in the factory is the only placement that provably reaches /api/health
  // and /api/state too. onSend (not onRequest) so it sits at the same
  // lifecycle point as ws.ts's broadcast hook — one home for cross-cutting
  // response concerns — and so headers set here land on the final wire
  // response, errors included.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Robots-Tag", "noindex");
    return payload;
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/state", async () => getAppState(db));
  registerExportRoute(app, db);

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

  // Static serving registers LAST, after every literal /api route — the
  // wildcard is the catch-all sink, and find-my-way prefers literals anyway,
  // so the API keeps matching. An explicit root is served as given (a caller
  // naming a missing directory should fail loudly, not get a silent API-only
  // server); the resolved default only when the build actually exists.
  const webDist = options.webDist ?? webDistPathFromEnv();
  if (options.webDist !== undefined || existsSync(webDist)) {
    await registerStatic(app, webDist);
  }
  return app;
}
