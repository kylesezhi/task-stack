import type { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { DEFAULT_WEB_DIST_PATH, resolveWebDistRoot } from "./static.js";

// T14: one process serves the built web app at / AND the API. Resolution and
// static-serving behavior: integration tests point buildApp at a fixture
// dist tree so the SERVING tests never depend on whether a real `pnpm -r
// build` has run on this machine. Only the default-root test observes the
// machine's real state — deliberately, since the default branch is the one
// behavior you cannot inject: it asserts whichever default half this machine
// is in (built → serves; not built → API-only), with real assertions both
// ways. WEB_DIST_PATH is cleared between test files by src/test-setup.ts
// (setupFiles) so an operator's ambient env can't poison the suite; the
// nested env describe below sets and restores its own value per-test.
// Temp-file/cleanup helpers mirror state.test.ts (sidecar-safe rm, never the
// repo's own server/data.db).
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

/** A guaranteed-ABSENT path under a tracked temp dir. Fixed names under the
 * OS temp dir can collide with stale leftovers from an old run and fail the
 * `existsSync(...) === false` expectations; nesting a name that was never
 * created inside a fresh mkdtemp dir is absent by construction and removed
 * by afterEach. */
function missingPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-static-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  expect(existsSync(path)).toBe(false);
  return path;
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
  // The default must be a stable, module-relative web/dist (static.ts's
  // comment: one level up lands on server/ both in dev and prod). Asserted
  // EXACTLY via the module's own location, not basename-only (the db.test.ts
  // precedent stops at basenames, which would tolerate a misplaced tree that
  // merely shares the last path segments — e.g. server/foo/web/dist — and
  // still pass). This test file and static.ts both live in server/src/, so
  // the expected join mirrors static.ts's own computation exactly.
  it("defaults to web/dist beside the server package, module-relative", () => {
    // This test file (alongside static.ts in server/src/) mirrors static.ts's
    // own computation: moduleDir = server/src is the comment's "one level up
    // lands on server/", so repo-root web/dist is TWO levels up from here.
    expect(DEFAULT_WEB_DIST_PATH).toBe(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist"),
    );
  });

  it("resolveWebDistRoot: absolute input is passed through unchanged", () => {
    // mkdtemp produces an absolute path, so the fixture IS the absolute case.
    const dist = fixtureDist();
    expect(isAbsolute(dist)).toBe(true);
    expect(resolveWebDistRoot(dist)).toEqual({
      kind: "configured",
      source: "webDist option",
      root: dist,
    });
  });

  it("resolveWebDistRoot: relative input resolves to absolute", () => {
    const dist = fixtureDist();

    // Fixture dirs are absolute by construction (mkdtemp makes one), so
    // derive a genuinely relative spelling of it — assert non-absoluteness,
    // since a cwd on another drive/tree yields ".."-prefixed steps.
    const relativePath = relative(process.cwd(), dist);
    // Windows cross-drive: relative() returns an ABSOLUTE path there — the
    // absolute passthrough is covered by its own resolver test, so only
    // assert when we actually hold a relative spelling (Linux suite: always).
    if (!isAbsolute(relativePath)) {
      expect(relativePath).not.toBe("");
    }

    const fromOption = resolveWebDistRoot(relativePath);
    expect(fromOption).toEqual({
      kind: "configured",
      source: "webDist option",
      root: resolve(relativePath),
    });
    if (fromOption.kind === "configured") expect(isAbsolute(fromOption.root)).toBe(true);

    const fromEnv = resolveWebDistRoot(undefined, { WEB_DIST_PATH: relativePath });
    expect(fromEnv).toEqual({
      kind: "configured",
      source: "WEB_DIST_PATH env",
      root: resolve(relativePath),
    });
    if (fromEnv.kind === "configured") expect(isAbsolute(fromEnv.root)).toBe(true);
  });

  it("resolveWebDistRoot: WEB_DIST_PATH wins; unset env falls back to the default", () => {
    expect(resolveWebDistRoot(undefined, { WEB_DIST_PATH: "/abs/web-dist" })).toEqual({
      kind: "configured",
      source: "WEB_DIST_PATH env",
      root: "/abs/web-dist",
    });
    expect(resolveWebDistRoot(undefined, {})).toEqual({
      kind: "default",
      root: resolve(DEFAULT_WEB_DIST_PATH),
    });
  });

  it("resolveWebDistRoot: default shape holds even when the default is missing (via injected defaultRoot)", () => {
    const neverBuilt = missingPath("never-built-dist");
    expect(resolveWebDistRoot(undefined, {}, neverBuilt)).toEqual({
      kind: "default",
      root: neverBuilt,
    });
  });

  it("resolveWebDistRoot: a configured EMPTY value is invalid, never cwd (the data-exposure guard)", () => {
    // resolve("") and resolve("   ") both return process.cwd() — so an
    // empty configured value would silently serve the entire working
    // directory at / if it fell through to resolve(). The planner must call
    // it invalid instead; app.ts turns that into the loud startup error.
    expect(resolveWebDistRoot("")).toEqual({ kind: "invalid", source: "webDist option" });
    expect(resolveWebDistRoot("   ")).toEqual({ kind: "invalid", source: "webDist option" });
    expect(resolveWebDistRoot(undefined, { WEB_DIST_PATH: "" })).toEqual({
      kind: "invalid",
      source: "WEB_DIST_PATH env",
    });
    expect(resolveWebDistRoot(undefined, { WEB_DIST_PATH: "  " })).toEqual({
      kind: "invalid",
      source: "WEB_DIST_PATH env",
    });
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

  it("resolves a RELATIVE webDist option against process.cwd() and serves it", async () => {
    const db = trackedOpen(tempDbPath());
    const dist = fixtureDist();
    const relativeDist = relative(process.cwd(), dist);
    // Windows cross-drive: relative() returns an ABSOLUTE path there — skip
    // the strict relative assertion (absolute passthrough is covered in its
    // own test); the suite is Linux-targeted so below this runs as relative.
    if (!isAbsolute(relativeDist)) {
      expect(relativeDist).not.toBe("");
    }
    const app = await buildApp({ db, webDist: relativeDist });
    try {
      // If cwd-relative resolution were skipped, @fastify/static's checkPath
      // would reject the relative root with FST_STATIC_INVALID_OPTION and
      // buildApp would have rejected above.
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain("task-stack fixture build");
    } finally {
      await app.close();
    }
  });

  it("rejects with a clear error when the webDist option names a missing directory", async () => {
    const db = trackedOpen(tempDbPath());
    const missing = missingPath("no-such-dist");
    await expect(buildApp({ db, webDist: missing })).rejects.toThrow(
      new RegExp(`web dist directory not found: .+no-such-dist \\(set via webDist option\\)`),
    );
  });

  it("rejects with a clear error when the webDist option is EMPTY (never resolve-to-cwd)", async () => {
    const db = trackedOpen(tempDbPath());
    // "" would resolve to process.cwd() and serve server/data.db at / —
    // buildApp must refuse loudly instead (DECISIONS.md §9).
    await expect(buildApp({ db, webDist: "" })).rejects.toThrow(
      new RegExp(`web dist path is empty \\(set via webDist option\\)`),
    );
  });

  describe("WEB_DIST_PATH env", () => {
    // Only touched where a test sets it; afterEach restores the saved value
    // (reset to undefined per-test, cheap double-set robustness) so other
    // tests — including this file's own default-path cases — never see a
    // leaked env value. The suite-level setup file cleared ambient values
    // before every test file, so the baseline here is "unset".
    let saved: string | undefined;
    function setEnv(value: string): void {
      // Capture the pre-set baseline only on the FIRST set within a test:
      // `?? ` keeps the original in case one test ever sets twice, so the
      // restore always returns to pre-suite (undefined, cleared by
      // src/test-setup.ts), never to a previous test's fiction.
      saved = saved ?? process.env.WEB_DIST_PATH;
      process.env.WEB_DIST_PATH = value;
    }

    afterEach(() => {
      if (saved === undefined) {
        delete process.env.WEB_DIST_PATH;
      } else {
        process.env.WEB_DIST_PATH = saved;
      }
      saved = undefined;
    });

    it("serves when WEB_DIST_PATH names the fixture dir", async () => {
      const db = trackedOpen(tempDbPath());
      const dist = fixtureDist();
      setEnv(dist);
      const app = await buildApp({ db });
      try {
        const home = await app.inject({ method: "GET", url: "/" });
        expect(home.statusCode).toBe(200);
        expect(home.body).toContain("task-stack fixture build");
      } finally {
        await app.close();
      }
    });

    it("rejects with a clear error when WEB_DIST_PATH names a missing directory", async () => {
      const db = trackedOpen(tempDbPath());
      const missing = missingPath("env-no-such-dist");
      setEnv(missing);
      await expect(buildApp({ db })).rejects.toThrow(
        new RegExp(
          `web dist directory not found: .+env-no-such-dist \\(set via WEB_DIST_PATH env\\)`,
        ),
      );
    });

    it("rejects with a clear error when WEB_DIST_PATH is set but EMPTY", async () => {
      const db = trackedOpen(tempDbPath());
      // Set-but-empty is a configuration mistake, not "unset" — an operator
      // who set the variable gets the loud error, never an accidental
      // module-relative default AND never a resolve-to-cwd root.
      setEnv("");
      await expect(buildApp({ db })).rejects.toThrow(
        new RegExp(`web dist path is empty \\(set via WEB_DIST_PATH env\\)`),
      );
    });
  });

  it("the default root: serves the built page when present, boots API-only when missing", async () => {
    const db = trackedOpen(tempDbPath());
    // No webDist option and no WEB_DIST_PATH (cleared by the setup file and
    // restored to undefined by the env describe above). The default branch
    // cannot be injected without copying its whole logic, so this test
    // deliberately covers WHICHEVER default state this machine is in — and
    // both branches carry real assertions, so either run is a genuine proof:
    // present → / serves the built page AND the API stays live; missing →
    // / is a plain 404 (static skipped, nothing served) while the API stays
    // fully functional.
    const app = await buildApp({ db });
    try {
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.headers["x-robots-tag"]).toBe("noindex");
      if (existsSync(DEFAULT_WEB_DIST_PATH)) {
        expect(home.statusCode).toBe(200);
        expect(home.headers["content-type"]?.toLowerCase()).toContain("text/html");
      } else {
        expect(home.statusCode).toBe(404);
      }
      // Either way: API-only boot health is the constant the matrix must
      // never break.
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
