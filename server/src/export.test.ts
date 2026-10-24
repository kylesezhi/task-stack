import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "@task-stack/shared";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

// Integration tests for T13: GET /api/export and the app-wide X-Robots-Tag:
// noindex header. Done-when mapping:
// - "curl -I shows the header" → the HEAD request in the noindex describe
//   (curl -I IS a HEAD request) plus GET/mutation/error coverage.
// - "a test verifies export contains everything /api/state does" → the first
//   test, field by field plus an exact key-set check.
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
  const dir = mkdtempSync(join(tmpdir(), "task-stack-export-"));
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

/** Small fixture with at least one row in every table plus an active stack. */
function seed(db: DatabaseSync): void {
  const params = (values: (string | number | null)[]) => values;
  db.prepare("INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)").run(
    ...params(["s1", "Work", 1, "2024-01-01T09:00:00.000Z"]),
  );
  db.prepare("INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)").run(
    ...params(["s2", "Home", 2, "2024-01-02T09:00:00.000Z"]),
  );
  db.prepare(
    "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(...params(["n1", "s1", "email Lee", 1, "2024-02-01T10:00:00.000Z"]));
  db.prepare(
    "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(...params(["n2", "s1", "write the shelf docs", 2, "2024-02-02T10:00:00.000Z"]));
  db.prepare(
    "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(...params(["n3", "s2", "water the plants", 1, "2024-02-03T10:00:00.000Z"]));
  db.prepare(
    `INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ...params([
      "c1",
      "call the bank",
      "s1",
      "Work",
      "2024-01-25T08:00:00.000Z",
      "2024-03-03T12:00:00.000Z",
    ]),
  );
  db.prepare(
    `INSERT INTO completed_notes (id, text, stack_id, stack_name, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ...params([
      "c2",
      "buy desk lamp",
      null,
      "Old Stack",
      "2024-01-20T08:00:00.000Z",
      "2024-03-02T12:00:00.000Z",
    ]),
  );
  db.prepare("INSERT INTO settings (key, value) VALUES ('active_stack_id', 's1')").run();
}

describe("GET /api/export", () => {
  it("contains everything /api/state does, plus exportedAt provenance", async () => {
    const db = trackedOpen(tempDbPath());
    seed(db);
    const app = await buildApp({ db });
    try {
      const exportRes = await app.inject({ method: "GET", url: "/api/export" });
      expect(exportRes.statusCode).toBe(200);
      const stateRes = await app.inject({ method: "GET", url: "/api/state" });
      const dump = exportRes.json() as AppState & { exportedAt: string };
      const state = stateRes.json() as AppState;
      // Field by field, so any drift between the two surfaces fails loudly.
      expect(dump.activeStackId).toEqual(state.activeStackId);
      expect(dump.stacks).toEqual(state.stacks);
      expect(dump.notes).toEqual(state.notes);
      expect(dump.completed).toEqual(state.completed);
      // Provenance is a canonical ISO-8601 UTC timestamp: Date.parse accepts
      // far too much ("2024", "March 3 2024"), so the shape itself is the
      // assertion — `toISOString()`'s fixed `YYYY-MM-DDTHH:MM:SS.mmmZ`.
      expect(dump.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Exactly the state keys plus exportedAt — no extra drift either way.
      expect(Object.keys(dump).sort()).toEqual([
        "activeStackId",
        "completed",
        "exportedAt",
        "notes",
        "stacks",
      ]);
    } finally {
      await app.close();
    }
  });

  it("answers a first-run server with the empty shape plus exportedAt", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: "GET", url: "/api/export" });
      expect(res.statusCode).toBe(200);
      const dump = res.json() as AppState & { exportedAt: string };
      expect(dump.activeStackId).toBe(null);
      expect(dump.stacks).toEqual([]);
      expect(dump.notes).toEqual([]);
      expect(dump.completed).toEqual([]);
      expect(dump.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await app.close();
    }
  });
});

describe("X-Robots-Tag: noindex (DECISIONS.md §9)", () => {
  // "server responses" — not just /api/export: reads, the curl -I HEAD
  // contract, a create-mutation (201), and an error (404) all carry it. A
  // crawler does not only ever meet the happy endpoints.
  const cases = [
    { label: "GET /api/export", method: "GET", url: "/api/export", expected: 200 },
    { label: "GET /api/state", method: "GET", url: "/api/state", expected: 200 },
    { label: "GET /api/health", method: "GET", url: "/api/health", expected: 200 },
    // curl -I is a HEAD request — the done-when's literal shape.
    { label: "HEAD /api/export (curl -I)", method: "HEAD", url: "/api/export", expected: 200 },
    {
      label: "POST /api/stacks (mutation, 201)",
      method: "POST",
      url: "/api/stacks",
      payload: { name: "Work" },
      expected: 201,
    },
    {
      label: "PATCH /api/stacks/ghost (error, 404)",
      method: "PATCH",
      url: "/api/stacks/ghost",
      payload: { name: "X" },
      expected: 404,
    },
    {
      label: "POST /api/stacks with invalid body (error, 400)",
      method: "POST",
      url: "/api/stacks",
      payload: {},
      expected: 400,
    },
    {
      // Unmatched route → a plain 404 carries the app-level header too.
      // Without a webDist this serves nothing static, so the APP's not-found
      // handler answers; static.test.ts proves the @fastify/static wildcard
      // 404 path carries the same header on a serving app — either 404
      // source lands on the header either way.
      label: "GET unmatched path (error, 404)",
      method: "GET",
      url: "/definitely-not-a-route",
      expected: 404,
    },
  ] as const;

  it("every server response carries the header", async () => {
    const db = trackedOpen(tempDbPath());
    const app = await buildApp({ db });
    try {
      for (const testCase of cases) {
        const res = await app.inject({
          method: testCase.method,
          url: testCase.url,
          payload: "payload" in testCase ? testCase.payload : undefined,
        });
        expect(res.statusCode, testCase.label).toBe(testCase.expected);
        expect(res.headers["x-robots-tag"], testCase.label).toBe("noindex");
      }
    } finally {
      await app.close();
    }
  });
});
