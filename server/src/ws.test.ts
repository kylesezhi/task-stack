import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";

// Integration tests for T12 WebSocket sync. `app.inject()` cannot perform a
// WS upgrade, so every test starts a real listening server (port 0 on
// 127.0.0.1) and connects Node's built-in global WebSocket clients (stable
// since Node 22 — no new test deps). HTTP mutations go through global fetch
// against the live port. Done-when mapping per test in the describe blocks.
//
// Cleanup mirrors the established pattern (tracked opens, sidecar-safe temp
// dirs, never the repo's own server/data.db), plus WS teardown: sockets
// closed first, then app.close() (the @fastify/websocket plugin terminates
// any remaining server-side clients), then dbs — the same order index.ts
// uses at shutdown.
const openDbs: DatabaseSync[] = [];
const tempDirs: string[] = [];
const apps: FastifyInstance[] = [];
const appClosed = new WeakSet<FastifyInstance>();
const sockets: WebSocket[] = [];

function trackedOpen(path: string): DatabaseSync {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "task-stack-ws-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

function trackedApp(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

function trackedSocket(socket: WebSocket): WebSocket {
  sockets.push(socket);
  return socket;
}

/** Safe close: app.close() twice throws FST_ERR_INSTANCE_ALREADY_CLOSED
 * (tests close explicitly at the end AND afterEach backstops failures). */
async function closeApp(app: FastifyInstance): Promise<void> {
  if (!appClosed.has(app)) {
    appClosed.add(app);
    await app.close();
  }
}

afterEach(async () => {
  // Close client sockets BEFORE app.close() so teardown order mirrors
  // index.ts and no server-side termination races an already-failing test.
  await Promise.allSettled(
    sockets.splice(0).map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.addEventListener("close", () => resolve(), { once: true });
          socket.close();
        }),
    ),
  );
  for (const app of apps.splice(0)) {
    if (!appClosed.has(app)) await closeApp(app);
  }
  for (const db of openDbs.splice(0)) {
    if (db.isOpen) db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Raw-SQL seeding with fixed ISO timestamps — expected snapshots are exact
// and human-checkable (established pattern: state.test.ts, stacks.test.ts).
type InsertParameters = readonly (string | number | null)[];

function run(db: DatabaseSync, sql: string, params: InsertParameters): void {
  db.prepare(sql).run(...params);
}

function insertStack(
  db: DatabaseSync,
  id: string,
  name: string,
  position: number,
  createdAt: string,
): void {
  run(db, "INSERT INTO stacks (id, name, position, created_at) VALUES (?, ?, ?, ?)", [
    id,
    name,
    position,
    createdAt,
  ]);
}

function insertNote(
  db: DatabaseSync,
  id: string,
  stackId: string,
  text: string,
  position: number,
): void {
  run(db, "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    stackId,
    text,
    position,
    "2024-02-01T10:00:00.000Z",
  ]);
}

function insertSettings(db: DatabaseSync, key: string, value: string): void {
  run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
}

/** Seeds: s1 "Work" (pos 1, notes n1 top + n2 at pos 2), s2 "Home" (pos 2,
 * no notes), active stack = s1. */
function seed(db: DatabaseSync): void {
  insertStack(db, "s1", "Work", 1, "2024-01-01T08:00:00.000Z");
  insertStack(db, "s2", "Home", 2, "2024-01-02T08:00:00.000Z");
  insertNote(db, "n1", "s1", "first", 1);
  insertNote(db, "n2", "s1", "second", 2);
  insertSettings(db, "active_stack_id", "s1");
}

/** Builds the app, listens on an ephemeral localhost port, returns the
 * origin URL for fetch/WebSocket connections. */
async function startServer(db: DatabaseSync): Promise<{
  app: FastifyInstance;
  origin: string;
}> {
  const app = await buildApp({ db });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("listening server must report a numeric port");
  }
  return { app: trackedApp(app), origin: `http://127.0.0.1:${address.port}` };
}

/** Connects a WS client and resolves once it is usable. */
async function connect(origin: string): Promise<WsClient> {
  const socket = trackedSocket(new WebSocket(`ws://127.0.0.1:${new URL(origin).port}/api/ws`));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timed out")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws connect failed"));
    });
  });
  return new WsClient(socket);
}

/** Records every received message in arrival order. `next()` FIFO-awaits the
 * next unseen message (failing loudly on a 5s quiet window instead of
 * hanging); `count()` reads how many have arrived (used after a settle). */
class WsClient {
  readonly raw: string[] = [];
  /** Index of the next message a `next()` call should return — consumed
   * messages are already handed out and must never be re-returned. */
  private consumed = 0;
  private readonly waiters: Array<(raw: string) => void> = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const text = String(event.data);
      this.raw.push(text);
      // Earliest outstanding waiter takes the oldest unconsumed message —
      // FIFO.
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        this.consumed++;
        waiter(text);
      }
    });
  }

  /** Await the next message in FIFO order. If an unconsumed message has
   * already queued up, it resolves immediately. */
  next(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(wait);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`ws message timeout (received ${this.raw.length} messages so far)`));
      }, 5000);
      const wait = (raw: string): void => {
        clearTimeout(timer);
        resolve(raw);
      };
      // The message listener runs on the event loop, never between the
      // buffered check and the push below (same synchronous block), so no
      // message can fall into the gap.
      if (this.raw.length > this.consumed + this.waiters.length) {
        clearTimeout(timer);
        const raw = this.raw[this.consumed];
        this.consumed++;
        resolve(raw as string);
        return;
      }
      this.waiters.push(wait);
    });
  }

  count(): number {
    return this.raw.length;
  }
}

/** setTimeout promise — the deliberate quiet period asserting "no further
 * messages" after the expected ones have been consumed. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchState(origin: string): Promise<unknown> {
  return (await fetch(`${origin}/api/state`)).json();
}

interface StateShape {
  activeStackId: string | null;
  stacks: Array<{ id: string; name: string }>;
  notes: Array<{ id: string; stackId: string; text: string; position: number }>;
  completed: Array<unknown>;
}

// The done-when: "two WS clients — client A pushes a note, both A and B
// receive identical updated snapshots" (test 2) and "sequential mutations
// don't miss broadcasts" (test 3). Tests 1, 4, 5 pin the connect-time and
// negative halves of the contract.
describe("websocket sync", () => {
  it(
    "send full state on connect: every client gets one immediate snapshot, byte-identical to peers and to GET /api/state",
    { timeout: 10_000 },
    async () => {
      const db = trackedOpen(tempDbPath());
      seed(db);
      const { app, origin } = await startServer(db);

      const a = await connect(origin);
      const b = await connect(origin);

      const rawA = await a.next();
      const rawB = await b.next();

      // Byte-identical between the two clients: the state serializer is
      // deterministic (id tie-breaks per state.ts), so two connections see
      // the same bytes — the property every sync client relies on.
      expect(rawA).toBe(rawB);

      // And it parses to exactly what GET /api/state answers with.
      expect(JSON.parse(rawA) as unknown).toEqual(await fetchState(origin));

      // Exactly one message each — nothing else arrives after a settle.
      await settle(200);
      expect(a.count()).toBe(1);
      expect(b.count()).toBe(1);

      await closeApp(app);
    },
  );

  it(
    "both clients receive identical updated snapshots when one pushes a note — byte-identical to the POST response",
    { timeout: 10_000 },
    async () => {
      const db = trackedOpen(tempDbPath());
      seed(db);
      const { app, origin } = await startServer(db);

      const a = await connect(origin);
      const b = await connect(origin);
      // Drain the on-connect snapshots.
      await a.next();
      await b.next();

      const response = await fetch(`${origin}/api/stacks/s1/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "pushed" }),
      });
      expect(response.status).toBe(201);
      const responseText = await response.text();

      // Exactly one new message per client, byte-identical to the HTTP
      // response and to each other (the app.ts contract: the WS broadcast
      // IS the mutation response payload).
      const rawA = await a.next();
      const rawB = await b.next();
      expect(rawA).toBe(responseText);
      expect(rawB).toBe(rawA);

      // And it parses to the follow-up GET /api/state truth.
      expect(JSON.parse(rawA) as unknown).toEqual(await fetchState(origin));

      // Order invariant: pushed note at position 1; older notes shifted up
      // (n1 → 2, n2 → 3 — push shifts EVERY row, not just the old top).
      const state = (await fetchState(origin)) as StateShape;
      expect(state.notes[0]?.position).toBe(1);
      expect(state.notes.filter((n) => n.stackId === "s1").map((n) => n.position)).toEqual([
        1, 2, 3,
      ]);

      await closeApp(app);
    },
  );

  it(
    "sequential mutations across ALL 9 routes broadcast every step to both clients — none missed, none duplicated",
    { timeout: 10_000 },
    async () => {
      const db = trackedOpen(tempDbPath());
      seed(db);
      const { app, origin } = await startServer(db);

      const a = await connect(origin);
      const b = await connect(origin);
      await a.next(); // on-connect snapshot
      await b.next();

      // One scripted call per mutation route, each stepped through next() on
      // BOTH clients so a missed or duplicated broadcast fails here loudly.
      // Step order respects route dependencies (s3 must exist before it is
      // patched/deleted; the second push must land before edit/reorder/
      // complete/toss touch the new note). Exactly 10 successful mutations
      // follow (9 routes; the notes POST is exercised twice to keep the
      // stack writable for edit/reorder/complete/toss).
      //
      // 1. POST /api/stacks — creates a stack "Errands" (random uuid —
      // captured below for steps 4 and 10) and activates it.
      let errandsId: string;
      {
        const res = await fetch(`${origin}/api/stacks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Errands" }),
        });
        expect(res.status).toBe(201);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const state = JSON.parse(rawA) as StateShape;
        expect(state.stacks.map((s) => s.name)).toEqual(["Work", "Home", "Errands"]);
        // Step-1 invariant, from the broadcast payload: the created stack
        // becomes active (create + activate in one transaction).
        expect(state.activeStackId).toBe(state.stacks[2]?.id);
        errandsId = state.stacks[2]?.id as string;
      }

      // 2. PUT /api/active — switch back to s1.
      {
        const res = await fetch(`${origin}/api/active`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stackId: "s1" }),
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        expect((JSON.parse(rawA) as StateShape).activeStackId).toBe("s1");
      }

      // 3. PATCH /api/stacks/s1 — rename (name-only branch).
      {
        const res = await fetch(`${origin}/api/stacks/s1`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Deep Work" }),
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const state = JSON.parse(rawA) as StateShape;
        expect(state.stacks.find((s) => s.id === "s1")?.name).toBe("Deep Work");
      }

      // 4. PATCH /api/stacks/:id — move "Errands" to drawer position 1.
      {
        const res = await fetch(`${origin}/api/stacks/${errandsId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ position: 1 }),
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const state = JSON.parse(rawA) as StateShape;
        expect(state.stacks[0]).toMatchObject({ id: errandsId, position: 1 });
      }

      // 5. POST /api/stacks/s1/notes — push another note on s1 (3rd pending).
      {
        const res = await fetch(`${origin}/api/stacks/s1/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "second pushed" }),
        });
        expect(res.status).toBe(201);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        expect(
          (JSON.parse(rawA) as StateShape).notes.filter((n) => n.stackId === "s1"),
        ).toHaveLength(3);
      }

      // 6. PATCH /api/notes/:id — edit the brand-new top note's text.
      let topId: string;
      {
        const before = (await fetchState(origin)) as StateShape;
        topId = before.notes[0]?.id as string;
        const res = await fetch(`${origin}/api/notes/${topId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "edited top" }),
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const after = JSON.parse(rawA) as StateShape;
        expect(after.notes[0]).toMatchObject({ id: topId, text: "edited top" });
      }

      // 7. PUT /api/stacks/s1/notes/order — reverse s1's three notes.
      {
        const before = (await fetchState(origin)) as StateShape;
        const s1Ids = before.notes.filter((n) => n.stackId === "s1").map((n) => n.id);
        const res = await fetch(`${origin}/api/stacks/s1/notes/order`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteIds: [...s1Ids].reverse() }),
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const after = JSON.parse(rawA) as StateShape;
        expect(after.notes.filter((n) => n.stackId === "s1").map((n) => n.id)).toEqual(
          [...s1Ids].reverse(),
        );
      }

      // 8. POST /api/notes/:id/complete — after the reversal, the edited note
      // is bottom-most; completing it grows completed to 1, s1 pending → 2.
      {
        const before = (await fetchState(origin)) as StateShape;
        const s1Ids = before.notes.filter((n) => n.stackId === "s1").map((n) => n.id);
        const targetId = s1Ids.at(-1) as string;
        const res = await fetch(`${origin}/api/notes/${targetId}/complete`, {
          method: "POST",
        });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const after = JSON.parse(rawA) as StateShape;
        expect(after.completed).toHaveLength(1);
        expect(after.notes.filter((n) => n.stackId === "s1")).toHaveLength(2);
      }

      // 9. DELETE /api/notes/:id — toss the top note; s1 pending → 1.
      {
        const before = (await fetchState(origin)) as StateShape;
        const top = before.notes[0];
        expect(top).toBeDefined();
        const res = await fetch(`${origin}/api/notes/${top?.id}`, { method: "DELETE" });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const after = JSON.parse(rawA) as StateShape;
        expect(after.notes).toHaveLength(1);
        expect(after.completed).toHaveLength(1);
      }

      // 10. DELETE /api/stacks/:id — delete "Errands" (no pending notes; s1
      // is actively selected, so the pointer must not change).
      {
        const res = await fetch(`${origin}/api/stacks/${errandsId}`, { method: "DELETE" });
        expect(res.status).toBe(200);
        const rawA = await a.next();
        expect(await b.next()).toBe(rawA);
        const after = JSON.parse(rawA) as StateShape;
        expect(after.stacks.map((s) => s.id)).toEqual(["s1", "s2"]);
        expect(after.activeStackId).toBe("s1");
      }

      // No missed, no duplicated: on-connect snapshot + exactly 10 broadcasts.
      await settle(200);
      expect(a.count()).toBe(1 + 10);
      expect(b.count()).toBe(1 + 10);

      // The final received broadcast (message 11) still parses to live truth.
      const finalRaw = a.raw[10];
      expect(finalRaw).toBeDefined();
      expect(finalRaw).toBe(b.raw[10]);
      expect(JSON.parse(finalRaw as string) as unknown).toEqual(await fetchState(origin));

      await closeApp(app);
    },
  );

  it("failed mutations (404, 400) broadcast nothing", { timeout: 10_000 }, async () => {
    const db = trackedOpen(tempDbPath());
    seed(db);
    const { app, origin } = await startServer(db);

    const a = await connect(origin);
    const b = await connect(origin);
    await a.next();
    await b.next();

    // 404 push to an unknown stack.
    const notFound = await fetch(`${origin}/api/stacks/nope/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "should 404" }),
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: "Stack not found" });

    // 400 invalid body (whitespace-only text).
    const invalid = await fetch(`${origin}/api/stacks/s1/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as unknown).toHaveProperty("error");

    // Neither error replays to any socket: the onSend filter requires 2xx.
    await settle(200);
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(1);

    await closeApp(app);
  });

  it(
    "late joiner: a client connecting mid-stream receives the CURRENT state first",
    { timeout: 10_000 },
    async () => {
      const db = trackedOpen(tempDbPath());
      seed(db);
      const { app, origin } = await startServer(db);

      const a = await connect(origin);
      await a.next();

      await fetch(`${origin}/api/stacks/s1/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "queued before B" }),
      });
      await a.next();

      // B connects AFTER the mutation — its first message must be current
      // truth, not a stale pre-mutation snapshot.
      const b = await connect(origin);
      const rawB = await b.next();
      expect(JSON.parse(rawB) as unknown).toEqual(await fetchState(origin));

      await closeApp(app);
    },
  );
});
