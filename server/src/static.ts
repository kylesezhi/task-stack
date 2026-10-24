import { dirname, join, resolve } from "node:path";
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
 * How the web dist root was decided:
 * - `configured` — an explicit source (the `webDist` option or the
 *   WEB_DIST_PATH env) named an existing value (trimmed-nonempty);
 *   app.ts treats configured-but-missing as a loud startup error.
 * - `invalid` — a configured source was SET but its value is empty or all
 *   whitespace. Reported loudly by app.ts, never silently ignored: resolve("")
 *   and resolve("   ") both return process.cwd() (path.resolve does not trim),
 *   so treating an empty configured value as a path would serve the ENTIRE
 *   working directory at / — data.db and all — an open-server data-exposure
 *   bug (DECISIONS.md §9). An operator who set the variable must get the
 *   error, not an accidental default.
 * - `default` — the module-relative fallback; missing there just means "no
 *   web build yet" (fresh checkout) and static serving is skipped.
 */
export type WebDistRoot =
  | { kind: "configured"; source: "webDist option" | "WEB_DIST_PATH env"; root: string }
  | { kind: "invalid"; source: "webDist option" | "WEB_DIST_PATH env" }
  | { kind: "default"; root: string };

/**
 * Pure planner for the web dist root (app.ts consumes it — the single
 * enforcement point; nothing throws here). Precedence: `webDist` option →
 * WEB_DIST_PATH env → module-relative default. A configured `root` is ALWAYS
 * absolute — @fastify/static's checkPath rejects a relative root with
 * FST_STATIC_INVALID_OPTION, so relative values (the natural
 * `WEB_DIST_PATH=web/dist`) are resolved against process.cwd() here, before
 * the plugin can reject them. A trimmed-empty configured value yields the
 * `invalid` kind instead (see the WebDistRoot doc for why "set but empty" is
 * a loud error rather than a silent unset). The kinds let app.ts enforce
 * different rules per branch rather than sniffing which input was set.
 * `defaultRoot` is injectable so tests can prove default-missing behavior
 * without depending on whether a real `pnpm -r build` ran on this machine.
 */
export function resolveWebDistRoot(
  explicit: string | undefined,
  env: WebDistEnv = process.env,
  defaultRoot: string = DEFAULT_WEB_DIST_PATH,
): WebDistRoot {
  if (explicit !== undefined) {
    if (explicit.trim() === "") {
      return { kind: "invalid", source: "webDist option" };
    }
    return { kind: "configured", source: "webDist option", root: resolve(explicit) };
  }
  if (env.WEB_DIST_PATH !== undefined) {
    if (env.WEB_DIST_PATH.trim() === "") {
      return { kind: "invalid", source: "WEB_DIST_PATH env" };
    }
    return { kind: "configured", source: "WEB_DIST_PATH env", root: resolve(env.WEB_DIST_PATH) };
  }
  return { kind: "default", root: resolve(defaultRoot) };
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
