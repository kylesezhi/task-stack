import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

// Real file DBs (never :memory:) because rows behind /api/state must come back
// exactly as a running server would see them. Cleanup helpers are local copies
// of the db.test.ts pattern — tracked opens plus temp-dir removal so the -wal/
// -shm sidecars go too and the repo's own server/data.db is never touched.
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-app-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

function closeAll(): void {
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close();
  }
}

afterEach(() => {
  closeAll(); // close first, then rm — open handles would block nothing but keep it tidy
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("app factory", () => {
  it("answers /api/health via inject() without listening on a port", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
    // Contract: the app never closes the injected db (the caller owns the
    // lifecycle; index.ts closes it after app.close() on shutdown signals).
    // If a future onClose hook closed it, production shutdown would hit a
    // double close — this fails loudly here instead.
    expect(db.isOpen).toBe(true);
  });
});
