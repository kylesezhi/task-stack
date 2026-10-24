import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fastify, type FastifyInstance } from "fastify";
import { registerExportRoute } from "./export.js";
import { getAppState } from "./state.js";
import { registerStatic, resolveWebDistRoot } from "./static.js";
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
   * job for ops). CONFIGURED values (this option or WEB_DIST_PATH) are
   * validated loudly in buildApp: a set-but-missing path and a set-but-empty
   * one ("" or whitespace — resolve("") would mean process.cwd(), i.e.
   * serving the whole repo shell life data.db included, DECISIONS.md §9)
   * both throw an Error naming the value's source. Unset → WEB_DIST_PATH
   * env, else the module-relative default (static.ts) — and when that
   * default directory does not exist (an API-only checkout, no
   * `pnpm -r build` yet) static serving is skipped instead: the API still
   * boots, and the dev-time UI is vite's own server anyway.
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
  // so the API keeps matching. resolveWebDistRoot classifies the input (its
  // `root`, when present, is always absolute — relative values like the
  // natural `WEB_DIST_PATH=web/dist` are resolved by the resolver and SERVE);
  // buildApp is the single enforcement point for the matrix:
  // - configured + missing → loud startup error. app.ts must catch this
  //   itself because @fastify/static's checkPath only WARNS on a missing
  //   root: the wildcard still registers and / would 404 forever — a quiet
  //   malfunction instead of an actionable failure.
  // - configured + empty/whitespace → loud startup error (an accidental
  //   process.cwd() root would expose server/data.db at /; DECISIONS.md §9).
  // - configured + present → serve (the resolver already made it absolute).
  // - default + present → serve, exactly the production flow.
  // - default + missing → skip static entirely (fresh API-only checkout;
  //   the dev UI is vite's own server) — the API-only boot must not die on
  //   an optional artifact that just hasn't been built yet.
  const webDist = resolveWebDistRoot(options.webDist);
  switch (webDist.kind) {
    case "invalid":
      throw new Error(`web dist path is empty (set via ${webDist.source})`);
    case "configured":
      if (!existsSync(webDist.root)) {
        throw new Error(
          `web dist directory not found: ${webDist.root} (set via ${webDist.source})`,
        );
      }
      await registerStatic(app, webDist.root);
      break;
    case "default":
      if (existsSync(webDist.root)) {
        await registerStatic(app, webDist.root);
      }
      break;
  }
  return app;
}
