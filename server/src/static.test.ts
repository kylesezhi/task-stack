import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { DEFAULT_WEB_DIST_PATH, webDistPathFromEnv } from "./static.js";

// T14: one process serves the built web app at / AND the API. Integration
// tests point buildApp at a fixture dist tree (the option exists precisely so
// tests never depend on whether a real `pnpm -r build` has run on this
// machine); the default-path behavior is the module-relative resolution unit
// test plus the task's manual done-when (`pnpm -r build && node
// server/dist/index.js`). Temp-file/cleanup helpers mirror state.test.ts
// (sidecar-safe rm, never the repo's own server/data.db).
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-static-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A minimal web/dist stand-in: index.html + one nested asset. */
function fixtureDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-webdist-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<html><body>task-stack fixture build</body></html>\n");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log('fixture bundle');\n");
  return dir;
}

describe("web dist path resolution", () => {
  // Same shape as db.test.ts's DEFAULT_DB_PATH test: prove the module-relative
  // default without hard-coding absolute paths.
  it("defaults to web/dist beside the server package", () => {
    expect(basename(DEFAULT_WEB_DIST_PATH)).toBe("dist");
    expect(basename(dirname(DEFAULT_WEB_DIST_PATH))).toBe("web");
  });

  it("WEB_DIST_PATH wins; absent env falls back to the default", () => {
    expect(webDistPathFromEnv({ WEB_DIST_PATH: "/abs/web-dist" })).toBe("/abs/web-dist");
    expect(webDistPathFromEnv({ WEB_DIST_PATH: "relative/dist" })).toBe("relative/dist");
    expect(webDistPathFromEnv({})).toBe(DEFAULT_WEB_DIST_PATH);
  });
});

describe("production static serving", () => {
  it("serves the built app at / with the API live in the same process", async () => {
    const db = trackedOpen(tempDbPath());
    const dist = fixtureDist();
    const app = await buildApp({ db, webDist: dist });
    try {
      // index.html at / — fastify-static serves it by default.
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.headers["content-type"]?.toLowerCase()).toContain("text/html");
      expect(home.body).toContain("task-stack fixture build");
      // The hygiene header covers static responses too (app-level hook,
      // inherited into the plugin scope).
      expect(home.headers["x-robots-tag"]).toBe("noindex");

      // Nested assets resolve.
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]?.toLowerCase()).toContain("javascript");
      expect(asset.body).toContain("fixture bundle");

      // The API routes still match — literals beat the wildcard, so one
      // process really serves both halves of the app.
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ ok: true });
      const state = await app.inject({ method: "GET", url: "/api/state" });
      expect(state.statusCode).toBe(200);
      expect(state.json()).toEqual({ activeStackId: null, stacks: [], notes: [], completed: [] });

      // Unknown paths 404 (with the hygiene header), not crash.
      const missing = await app.inject({ method: "GET", url: "/not-in-the-build" });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers["x-robots-tag"]).toBe("noindex");
    } finally {
      await app.close();
    }
  });

  it("answers HEAD / (the curl -I shape) with the page headers", async () => {
    const db = trackedOpen(tempDbPath());
    const dist = fixtureDist();
    const app = await buildApp({ db, webDist: dist });
    try {
      const res = await app.inject({ method: "HEAD", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]?.toLowerCase()).toContain("text/html");
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.body).toBe("");
    } finally {
      await app.close();
    }
  });
});
