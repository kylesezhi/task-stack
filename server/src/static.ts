import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

// Default web dist lives at repo-root web/dist, resolved relative to this
// module's location — the same trick as db.ts's DEFAULT_DB_PATH: one level up
// from this module lands on server/ both in dev (tsx runs server/src/) and
// prod (node runs server/dist/), so web/dist resolves identically either way
// and `node server/dist/index.js` from any cwd serves the same files.
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEB_DIST_PATH = join(dirname(moduleDir), "..", "web", "dist");

/** Environment subset read for web dist resolution (injectable for tests). */
export interface WebDistEnv {
  WEB_DIST_PATH?: string;
}

/**
 * Resolves the web dist directory: explicit WEB_DIST_PATH wins (absolute or
 * cwd-relative — used as given; T36's Docker image will point it at wherever
 * web/dist lands inside the image), else the module-relative default. Pure,
 * mirroring dbPathFromEnv.
 */
export function webDistPathFromEnv(env: WebDistEnv = process.env): string {
  return env.WEB_DIST_PATH ?? DEFAULT_WEB_DIST_PATH;
}

/**
 * Serves the built web app at `/` (T14: production mode — one process, UI and
 * API together). Registered LAST in buildApp, after every literal /api route:
 * find-my-way prefers literal paths over @fastify/static's wildcard, so the
 * API keeps matching regardless — but last-in-file also reads as "the
 * catch-all sink at the end of the table".
 *
 * SPA note: the app is a single page with no URL router (PLAN.md "Routes are
 * views, not URLs"), so there is no history-fallback to configure — / serves
 * index.html and that is the only route the client ever needs.
 */
export async function registerStatic(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root });
}
