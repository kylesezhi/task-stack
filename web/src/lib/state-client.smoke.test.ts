/**
 * Real-server smoke for the StateClient (T15) — env-gated so `pnpm -r test`
 * shows it skipped and green; run it explicitly via `pnpm --filter web test:smoke`.
 *
 * No mocks anywhere in this file: it spawns the REAL Fastify server (tsx, temp
 * SQLite file on a probed free port), then drives the client with Node's real
 * global `WebSocket` and real `fetch` (both exist in Node ≥ 24). Fast backoff
 * is what keeps the reconnect phase quick.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { StateClient } from "./state-client";

// Roomy ceil: spawned process, network round-trips, and a restart — the poll
// loops must be safely clear of the suite timeout.
const WAIT_TIMEOUT_MS = 15_000;
const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve_) => setTimeout(resolve_, ms));
}

/** Polls an async predicate until it returns a truthy value (awaited). */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(POLL_MS);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Probes a free TCP port: binds port 0 on loopback, reads the assigned port,
 * then closes. The OS will not reassign it between here and the server's
 * listen in practice (and a collision would fail the health poll loudly).
 */
function probeFreePort(): Promise<number> {
  return new Promise((resolve_, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("probe listen gave no TCP port"));
        return;
      }
      resolve_(address.port);
      probe.close();
    });
  });
}

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server");

/** Grace window before SIGTERM escalates to SIGKILL in kill(). */
const TERM_GRACE_MS = 5_000;

interface SpawnedServer {
  url: string;
  child: ChildProcess;
  kill: () => Promise<void>;
  exited: Promise<number | null>;
}

/** Spawns the real server (node + tsx) on `port` with a dedicated DB file. */
function spawnServer(port: number, dbPath: string): SpawnedServer {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DB_PATH: dbPath },
    stdio: "ignore", // truth comes from the health poll, not logs
  });
  const exited = new Promise<number | null>((resolve_) => {
    child.once("exit", (code) => resolve_(code));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    child,
    exited,
    kill: () =>
      new Promise<void>((resolve_) => {
        // Already-exited children emit no further "exit" event — resolve immediately
        // (teardown kills every worker, including the ones the test already reaped).
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve_();
          return;
        }
        child.once("exit", () => resolve_());
        // Escalation: if SIGTERM (graceful close + WAL flush) hasn't landed
        // within the grace window, SIGKILL so a hung child cannot hang
        // teardown and orphan a process.
        const escalate = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, TERM_GRACE_MS);
        escalate.unref();
        child.once("exit", () => clearTimeout(escalate));
        if (!child.killed) child.kill("SIGTERM"); // index.ts handles it: close + flush WAL + exit(0)
      }),
  };
}

/** Polls GET /api/health until 200 — never parses child logs. */
async function waitHealthy(url: string): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(`${url}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  });
}

describe.skipIf(process.env.SMOKE_REAL !== "1")("StateClient against the real server", () => {
  it(
    "connects, pushes through, mirrors external devices, and resyncs after a server restart",
    { timeout: 60_000 },
    async () => {
      const port = await probeFreePort();
      const workDir = mkdtempSync(join(tmpdir(), "task-stack-smoke-"));
      const dbPath = join(workDir, "data.db");
      const wsUrl = `ws://127.0.0.1:${port}/api/ws`;

      // Fast backoff keeps the killed-server + respawn phase quick while the
      // same StateClient machinery (close → offline → scheduled retry) runs.
      //
      // The client's mutation paths are same-origin-relative ("/api/...") —
      // its designed-correct behavior for the browser/vite-proxy. Node's
      // global fetch has no origin to resolve them against, so this smoke
      // provides real global fetch behind a thin relative→absolute prefix
      // (the socket factory is the true DEFAULT — `new WebSocket(wsUrl)`).
      const base = `http://127.0.0.1:${port}`;
      const absoluteFetch = (
        url: string,
        init: { method: string; headers?: Record<string, string>; body?: string },
      ) => fetch(url.startsWith("/") ? `${base}${url}` : url, init as RequestInit);
      const client = new StateClient({
        wsUrl,
        backoff: { initialMs: 150, factor: 2, maxMs: 1000 },
        fetchImpl: absoluteFetch,
      });
      // Notify counter: proves a NEW snapshot notification arrived on
      // reconnect, not just state that happens to equal what we already hold.
      let snapshotNotifies = 0;
      client.onSnapshot(() => {
        snapshotNotifies += 1;
      });

      let deviceB: WebSocket | undefined;
      let first: SpawnedServer | undefined;
      try {
        // -- Phase 1: connect, initial empty snapshot -------------------------
        first = spawnServer(port, dbPath);
        await waitHealthy(first.url);
        client.start();
        await waitFor(() => client.getSnapshot() !== null && client.getStatus() === "online");
        expect(client.getSnapshot()?.activeStackId).toBe(null); // empty DB = first run
        expect(client.getSnapshot()?.stacks).toEqual([]);

        // -- Phase 2: create a stack (HTTP response applies the snapshot) ----
        expect(await client.createStack("Work")).toEqual({ ok: true });
        const stackId = client.getSnapshot()!.stacks[0]!.id;
        expect(client.getSnapshot()?.stacks).toHaveLength(1);
        expect(client.getSnapshot()?.activeStackId).toBe(stackId);

        // -- Phase 3: push a note; it lands at position 1 ---------------------
        expect(await client.pushNote(stackId!, "first")).toEqual({ ok: true });
        const notesAfterFirst = client.getSnapshot()?.notes;
        expect(notesAfterFirst).toHaveLength(1);
        expect(notesAfterFirst?.map((note) => note.text)).toEqual(["first"]);
        expect(notesAfterFirst?.map((note) => note.position)).toEqual([1]);

        // -- Phase 4: a second device sees the WS broadcast path -------------
        let lastBRaw = "";
        deviceB = new WebSocket(wsUrl);
        deviceB.addEventListener("message", (event) => {
          lastBRaw = String(event.data);
        });
        await new Promise<void>((resolve_, reject) => {
          deviceB!.addEventListener("open", () => resolve_());
          deviceB!.addEventListener("error", () => reject(new Error("device B failed to open")));
        });
        await waitFor(() => lastBRaw !== ""); // device B drains its on-connect snapshot
        expect(JSON.parse(lastBRaw).notes).toHaveLength(1);

        // Device B mutates over HTTP (device A touches nothing) — device A
        // must still learn about it through the WS broadcast.
        const pushResponse = await fetch(`${first.url}/api/stacks/${stackId}/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "second" }),
        });
        expect(pushResponse.ok).toBe(true);
        await waitFor(() => (client.getSnapshot()?.notes.length ?? 0) === 2);
        expect(
          client
            .getSnapshot()
            ?.notes.filter((note) => note.stackId === stackId)
            .map((note) => note.text),
        ).toEqual(["second", "first"]); // newest first (position 1 = top)
        deviceB.close();

        // -- Phase 5: kill the server → offline (graceful SIGTERM, exit 0) --
        await first.kill();
        expect(await first.exited).toBe(0); // exactly 0: the graceful SIGTERM path
        await waitFor(() => client.getStatus() === "offline");

        // While the client is disconnected, write a third note straight into
        // the temp DB with node:sqlite. The server exited via SIGTERM
        // (graceful: WAL checkpointed), so the file is consistent and no
        // handle holds it. This makes the phase-6 resync assertion honest:
        // the respawned server's snapshot genuinely differs from what the
        // client already holds.
        const injectedId = randomUUID();
        const injectedAt = new Date().toISOString();
        {
          const db = new DatabaseSync(dbPath);
          try {
            const stackRow = db.prepare("SELECT id FROM stacks WHERE id = ?").get(stackId);
            expect(stackRow).toBeTruthy();
            db.prepare(
              "INSERT INTO notes (id, stack_id, text, position, created_at) VALUES (?, ?, ?, ?, ?)",
            ).run(injectedId, stackId, "offline injection", 3, injectedAt); // no renumbering needed
            const row = db.prepare("SELECT text FROM notes WHERE id = ?").get(injectedId) as {
              text: unknown;
            };
            expect(row.text).toBe("offline injection");
          } finally {
            db.close();
          }
        }

        // -- Phase 6: respawn on the SAME port + DB → resync on reconnect -----
        expect(await first.exited).toBe(0);
        const notifiesBeforeResync = snapshotNotifies;
        const second = spawnServer(port, dbPath);
        first = second;
        await waitHealthy(second.url);
        await waitFor(() => client.getStatus() === "online");
        // A NEW snapshot notification must actually arrive after the
        // reconnect — a stale-held state passing the lookups must not count.
        await waitFor(() => snapshotNotifies > notifiesBeforeResync);
        await waitFor(() => (client.getSnapshot()?.notes.length ?? 0) === 3);
        expect(
          client
            .getSnapshot()
            ?.notes.filter((note) => note.stackId === stackId)
            .map((n) => n.text),
        ).toContain("offline injection");
        expect(client.getSnapshot()?.activeStackId).toBe(stackId); // resync-on-reconnect
        second.child.kill("SIGTERM");
        await second.kill();
      } finally {
        // Stop the client FIRST so its reconnect loop can't race teardown.
        client.stop();
        if (deviceB !== undefined) {
          try {
            deviceB.close();
          } catch {
            // already closed
          }
        }
        if (first !== undefined) await first.kill();
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  );
});
