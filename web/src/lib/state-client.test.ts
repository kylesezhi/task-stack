import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@task-stack/shared";
import { StateClient, type WebSocketLike } from "./state-client";

// -- helpers ----------------------------------------------------------------

/** Valid AppState as JSON — every test starts from the empty-desk snapshot. */
function snapshotJson(overrides: Partial<AppState> = {}): string {
  return JSON.stringify({
    activeStackId: null,
    stacks: [],
    notes: [],
    completed: [],
    ...overrides,
  });
}

interface RecordedCall {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

interface QueuedResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/**
 * Fake socket per the injected-factory seam: records listeners, never fires
 * anything from close() — tests pull `openIt` / `messageIt` / `closeIt` by
 * hand, mirroring the real event timing the T12 server contract implies.
 */
class FakeWebSocket implements WebSocketLike {
  readonly url: string;
  closed = false;
  private openListeners: Array<() => void> = [];
  private closeListeners: Array<() => void> = [];
  private messageListeners: Array<(event: { data: unknown }) => void> = [];

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "open" | "close" | "message",
    listener: (() => void) | ((event: { data: unknown }) => void),
  ): void {
    if (type === "open") this.openListeners.push(listener as () => void);
    else if (type === "close") this.closeListeners.push(listener as () => void);
    else this.messageListeners.push(listener as (event: { data: unknown }) => void);
  }

  close(): void {
    // Records "closed" but does NOT fire the close event — closeIt() delivers
    // it, so the test controls reconnect timing exactly.
    this.closed = true;
  }

  openIt(): void {
    for (const listener of [...this.openListeners]) listener();
  }

  messageIt(raw: string): void {
    for (const listener of [...this.messageListeners]) listener({ data: raw });
  }

  /** Delivers a raw event object (arbitrary `data`) — for non-string tests. */
  eventIt(event: { data: unknown }): void {
    for (const listener of [...this.messageListeners]) listener(event);
  }

  closeIt(): void {
    for (const listener of [...this.closeListeners]) listener();
  }
}

function makeHarness(): {
  client: StateClient;
  sockets: FakeWebSocket[];
  latestSocket: () => FakeWebSocket | undefined;
  calls: RecordedCall[];
  respondWith: (response: QueuedResponse) => void;
} {
  const sockets: FakeWebSocket[] = [];
  const calls: RecordedCall[] = [];
  const queued: QueuedResponse[] = [];

  const fetchImpl = (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<QueuedResponse> => {
    calls.push({ url, ...init });
    // Default response: a fresh empty snapshot — truthful, so tests that only
    // care about the request don't need to queue one each time.
    return Promise.resolve(
      queued.shift() ?? { ok: true, status: 200, text: () => Promise.resolve(snapshotJson()) },
    );
  };

  const client = new StateClient({
    wsUrl: "ws://test/api/ws",
    // Fast, legible backoff for assertions: 100 → 200 → 400, capped at 400.
    backoff: { initialMs: 100, factor: 2, maxMs: 400 },
    createSocket: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    fetchImpl,
  });

  return {
    client,
    sockets,
    latestSocket() {
      return sockets[sockets.length - 1];
    },
    calls,
    respondWith: (response: QueuedResponse) => {
      queued.push(response);
    },
  };
}

// -- socket + snapshot lifecycle --------------------------------------------

describe("StateClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() connects, reports connecting → online, and applies the on-connect snapshot once", () => {
    const h = makeHarness();
    const { client, sockets } = h;
    const statuses: string[] = [];
    const snapshots: AppState[] = [];
    client.onStatus((st) => statuses.push(st));
    client.onSnapshot((snap) => snapshots.push(snap));

    client.start();
    expect(statuses).toEqual(["connecting"]);
    expect(sockets).toHaveLength(1);

    // The server sends the snapshot around connect; a message may arrive
    // either side of the "open" admit — both must apply.
    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    expect(snapshots).toHaveLength(1);
    expect(client.getSnapshot()?.activeStackId).toBe("s1");

    h.latestSocket()!.openIt();
    expect(statuses).toEqual(["connecting", "online"]);

    client.start(); // idempotent — no second socket
    expect(sockets).toHaveLength(1);
  });

  it("a later WS message replaces the snapshot (server truth wins, no merge) and notifies", () => {
    const h = makeHarness();
    const { client } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();

    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    h.latestSocket()!.messageIt(
      snapshotJson({
        activeStackId: "s2",
        stacks: [{ id: "s2", name: "Personal", position: 1, createdAt: "t0" }],
      }),
    );

    expect(snapshots).toHaveLength(2);
    expect(client.getSnapshot()?.stacks[0]?.name).toBe("Personal");
  });

  it("a byte-identical repeat message is deduped — no second notify", () => {
    const h = makeHarness();
    const { client } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();

    const raw = snapshotJson({ activeStackId: "s1" });
    h.latestSocket()!.messageIt(raw);
    h.latestSocket()!.messageIt(raw); // the T12 broadcast echo of the same mutation

    expect(snapshots).toHaveLength(1);
    expect(client.getSnapshot()?.activeStackId).toBe("s1");
  });

  it("reconnects with exponential backoff capped at maxMs, resetting on open", async () => {
    const h = makeHarness();
    const { client, sockets } = h;
    const statuses: string[] = [];
    const socketsOpen = (): number => sockets.length;
    client.onStatus((st) => statuses.push(st));
    client.start();
    h.latestSocket()!.openIt();

    // 1st failure: retry at initialMs (100), not before; status is offline
    // through the wait and only flips to connecting on the timer fire.
    h.latestSocket()!.closeIt();
    expect(statuses.at(-1)).toBe("offline");
    await vi.advanceTimersByTimeAsync(99);
    expect(socketsOpen()).toBe(1);
    expect(statuses.at(-1)).toBe("offline");
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses.slice(-2)).toEqual(["offline", "connecting"]);
    expect(socketsOpen()).toBe(2);

    // 2nd consecutive failure: delay doubles (200).
    sockets[1]!.closeIt();
    await vi.advanceTimersByTimeAsync(199);
    expect(socketsOpen()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(socketsOpen()).toBe(3);

    // 3rd failure: 400 (= min(100·2², 400)).
    sockets[2]!.closeIt();
    await vi.advanceTimersByTimeAsync(399);
    expect(socketsOpen()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(socketsOpen()).toBe(4);

    // 4th: raw delay would be 800 — capped at maxMs (400).
    sockets[3]!.closeIt();
    await vi.advanceTimersByTimeAsync(399);
    expect(socketsOpen()).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(socketsOpen()).toBe(5);

    // A successful open resets the counter — the next failure retries at 100.
    sockets[4]!.openIt();
    sockets[4]!.closeIt();
    await vi.advanceTimersByTimeAsync(99);
    expect(socketsOpen()).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(socketsOpen()).toBe(6);

    client.stop();
  });

  it("stop() prevents any reconnect after close", () => {
    const h = makeHarness();
    const { client, sockets } = h;
    client.start();
    client.stop();
    expect(client.getStatus()).toBe("offline");

    // The stop()-initiated close() delivers a trailing close event; neither
    // that, nor a later manual closeIt, may schedule a reconnect socket.
    h.latestSocket()!.openIt();
    h.latestSocket()!.closeIt();
    expect(sockets).toHaveLength(1);
  });

  it("stop() while a reconnect retry is pending never creates a new socket", async () => {
    const h = makeHarness();
    const { client, sockets } = h;
    client.start();
    h.latestSocket()!.openIt();
    h.latestSocket()!.closeIt(); // retry timer now pending (100ms)

    client.stop();
    // Generously past any schedule-up logic — even if old guts re-armed, no
    // socket may appear after stop().
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    expect(client.getStatus()).toBe("offline");
  });

  it("a trailing close from the OLD socket after stop() → start() is inert (identity guard)", async () => {
    const h = makeHarness();
    const { client, sockets } = h;
    client.start();
    const oldSocket = sockets[0]!;
    client.stop(); // started=false, oldSocket closed
    client.start(); // new live socket (same tick as stop in the worst case)
    expect(sockets).toHaveLength(2);

    oldSocket.closeIt(); // the OLD socket's trailing close event
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2); // no reconnect was scheduled
    expect(client.getStatus()).toBe("connecting"); // start()'s status only
  });

  it("an onStatus listener that calls stop() on 'offline' prevents the scheduled reconnect", async () => {
    const h = makeHarness();
    const { client, sockets } = h;
    client.onStatus((st) => {
      if (st === "offline") client.stop();
    });
    client.start();
    h.latestSocket()!.openIt();
    h.latestSocket()!.closeIt(); // fires 'offline' → listener stops the client

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1); // no new socket ever created
    expect(client.getStatus()).toBe("offline");
  });

  it("an onStatus listener that calls stop() on 'connecting' prevents even the first socket", () => {
    const h = makeHarness();
    const { client, sockets } = h;
    client.onStatus((st) => {
      if (st === "connecting") client.stop();
    });
    client.start(); // fires 'connecting' → listener stops the client

    expect(sockets).toHaveLength(0); // openSocket bailed on the guard
    expect(sockets[0]).toBeUndefined();
    expect(client.getStatus()).toBe("offline");
  });

  it("the retry timer's 'connecting'-time stop() never creates a second socket", async () => {
    const h = makeHarness();
    const { client, sockets } = h;
    let stopOnConnecting = false;
    client.onStatus((st) => {
      if (st === "connecting" && stopOnConnecting) client.stop();
    });
    client.start(); // 'connecting' fires un-armed → first socket is legit
    expect(sockets).toHaveLength(1);
    h.latestSocket()!.openIt();
    h.latestSocket()!.closeIt(); // schedules the retry timer (100ms)

    // Arm the listener for the retry's "connecting" notification: when the
    // timer fires it re-checks started (still true), sets "connecting", and
    // the listener stops the client synchronously — openSocket must bail.
    stopOnConnecting = true;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sockets).toHaveLength(1); // no new socket beyond the first
    expect(client.getStatus()).toBe("offline");
  });

  it("ignores malformed messages silently — state intact, no notify, no crash", () => {
    const h = makeHarness();
    const { client } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();

    const good = snapshotJson({ activeStackId: "s1" });
    h.latestSocket()!.messageIt(good);
    h.latestSocket()!.messageIt("not json at all");
    h.latestSocket()!.messageIt(JSON.stringify({ activeStackId: "s1", stacks: [] })); // missing members
    h.latestSocket()!.messageIt(
      JSON.stringify({ activeStackId: 42, stacks: [], notes: [], completed: [] }),
    );
    h.latestSocket()!.messageIt(JSON.stringify([1, 2, 3])); // not even an object

    expect(snapshots).toHaveLength(1);
    expect(client.getSnapshot()?.activeStackId).toBe("s1");
  });

  it("notifies every onSnapshot listener; unsubscribe silences only its own", () => {
    const h = makeHarness();
    const { client } = h;
    const seenA: AppState[] = [];
    const seenB: AppState[] = [];
    client.onSnapshot((snap) => seenA.push(snap));
    const offB = client.onSnapshot((snap) => seenB.push(snap));
    client.start();

    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    offB();
    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s2" }));

    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(1); // unsubscribed before the second frame
    expect(seenB[0]?.activeStackId).toBe("s1");
    expect(client.getSnapshot()?.activeStackId).toBe("s2");
  });

  it("ignores a non-string event.data (e.g. an object payload) without touching state", () => {
    const h = makeHarness();
    const { client } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();

    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    // Hand-rolled delivery with a non-string datum — `eventIt` mirrors the
    // typed `{ data: unknown }` listener surface exactly.
    h.latestSocket()!.eventIt({ data: {} });

    expect(snapshots).toHaveLength(1); // the good frame only
    expect(client.getSnapshot()?.activeStackId).toBe("s1");
  });
});

// -- mutation requests ------------------------------------------------------

describe("StateClient mutation helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("all nine helpers hit the right method, path, and JSON body", async () => {
    const { client, calls } = makeHarness();
    const bodies: Array<RecordedCall> = [
      {
        method: "POST",
        url: "/api/stacks",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Inbox" }),
      },
      {
        method: "PATCH",
        url: "/api/stacks/s1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      },
      {
        method: "PATCH",
        url: "/api/stacks/s1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: 2 }),
      },
      { method: "DELETE", url: "/api/stacks/s1" },
      {
        method: "PUT",
        url: "/api/active",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stackId: "s2" }),
      },
      {
        method: "POST",
        url: "/api/stacks/s1/notes",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      },
      {
        method: "PATCH",
        url: "/api/notes/n1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hola" }),
      },
      { method: "DELETE", url: "/api/notes/n1" },
      { method: "POST", url: "/api/notes/n1/complete" },
      {
        method: "PUT",
        url: "/api/stacks/s1/notes/order",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteIds: ["b", "a"] }),
      },
    ];

    // updateStack exercised twice (name-only and position-only) → 10 calls
    // over the 9 helpers.
    const results = [
      await client.createStack("Inbox"),
      await client.updateStack("s1", { name: "Renamed" }),
      await client.updateStack("s1", { position: 2 }),
      await client.deleteStack("s1"),
      await client.setActiveStack("s2"),
      await client.pushNote("s1", "hello"),
      await client.editNote("n1", "hola"),
      await client.tossNote("n1"),
      await client.completeNote("n1"),
      await client.reorderNotes("s1", ["b", "a"]),
    ];

    expect(results).toEqual(Array.from({ length: 10 }, () => ({ ok: true })));
    expect(calls).toEqual(bodies);
  });
});

// -- mutation responses -----------------------------------------------------

describe("StateClient mutation response handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a successful mutation response and dedupes the byte-identical WS broadcast", async () => {
    const h = makeHarness();
    const { client, respondWith } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();
    h.latestSocket()!.messageIt(snapshotJson()); // on-connect empty snapshot

    const fresh = snapshotJson({
      activeStackId: "s1",
      stacks: [{ id: "s1", name: "Work", position: 1, createdAt: "t0" }],
    });
    respondWith({ ok: true, status: 201, text: () => Promise.resolve(fresh) });
    expect(await client.createStack("Work")).toEqual({ ok: true });
    expect(snapshots).toHaveLength(2);
    expect(client.getSnapshot()?.activeStackId).toBe("s1");

    // The server then broadcasts the SAME bytes to all sockets (T12
    // byte-identical guarantee) — deduped: no second notify.
    h.latestSocket()!.messageIt(fresh);
    expect(snapshots).toHaveLength(2);
  });

  it("server 400/404 error bodies surface as { ok: false, error } and leave the snapshot alone", async () => {
    const h = makeHarness();
    const { client, respondWith } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();
    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    const before = client.getSnapshot();

    const failures = [
      { status: 400, message: "Text must contain at least 1 character" },
      { status: 404, message: "Stack not found" },
    ] as const;
    for (const { status, message } of failures) {
      respondWith({
        ok: false,
        status,
        text: () => Promise.resolve(JSON.stringify({ error: message })),
      });
      expect(await client.pushNote("s1", "")).toEqual({ ok: false, error: message });
    }

    expect(snapshots).toHaveLength(1); // a failed mutation never notifies
    expect(client.getSnapshot()).toBe(before);
  });

  it("a non-JSON error body degrades to a generic HTTP status message", async () => {
    const { client, respondWith } = makeHarness();
    respondWith({ ok: false, status: 500, text: () => Promise.resolve("<html>boom</html>") });
    expect(await client.tossNote("n1")).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("network rejection reports an unreachable server and leaves the snapshot alone", async () => {
    const client = new StateClient({
      wsUrl: "ws://test/api/ws",
      createSocket: () => new FakeWebSocket("ws://test/api/ws"),
      fetchImpl: (): Promise<never> => Promise.reject(new TypeError("network down")),
    });
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));

    const result = await client.pushNote("s1", "hello");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/reach the server/i);
    expect(snapshots).toHaveLength(0);
    expect(client.getSnapshot()).toBe(null);
  });

  it("a 2xx body that is not a snapshot fails loudly without touching state", async () => {
    const h = makeHarness();
    const { client, respondWith } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();
    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));

    respondWith({ ok: true, status: 200, text: () => Promise.resolve('{"done": true}') });
    expect(await client.deleteStack("s1")).toEqual({
      ok: false,
      error: expect.stringMatching(/Unexpected response body/),
    });
    // Rejected loudly, nothing applied, state intact.
    expect(snapshots).toHaveLength(1);
    expect(client.getSnapshot()?.activeStackId).toBe("s1");
  });

  // -- receiver-safe fetch (browser "Illegal invocation") ---------------------

  /** The (url, init) the sensitive stub actually received, for assertions. */
  let seenCall:
    | { url: string; init: { method: string; headers?: Record<string, string>; body?: string } }
    | undefined;

  /**
   * Regression for the browser brand check: browsers throw
   * `TypeError: Illegal invocation` when native fetch is invoked with a
   * receiver other than the window (e.g. as `this.fetchImpl(...)`). Node's
   * real fetch does NOT brand-check, so the DEFAULT path cannot be
   * regression-tested in Node — this stub simulates the browser semantics
   * instead: a NON-arrow function whose `this` is anything non-global throws
   * exactly what a browser throws; the detached call in `request()` leaves
   * `this === undefined` and must pass.
   */
  function receiverSensitiveFetch(
    this: unknown,
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<QueuedResponse> {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    seenCall = { url, init };
    return Promise.resolve({
      ok: true,
      status: 201,
      text: () =>
        Promise.resolve(
          snapshotJson({
            activeStackId: "s1",
            stacks: [{ id: "s1", name: "Work", position: 1, createdAt: "t0" }],
          }),
        ),
    });
  }

  it("invokes fetchImpl receiver-free — a browser-style brand-checked fetch does not throw (regression)", async () => {
    const snapshots: AppState[] = [];
    const client = new StateClient({
      wsUrl: "ws://test/api/ws",
      createSocket: () => new FakeWebSocket("ws://test/api/ws"),
      fetchImpl: receiverSensitiveFetch,
    });
    client.onSnapshot((snap) => snapshots.push(snap));

    expect(await client.pushNote("s1", "hello")).toEqual({ ok: true });
    expect(seenCall).toEqual({
      url: "/api/stacks/s1/notes",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      },
    });
    expect(client.getSnapshot()?.activeStackId).toBe("s1");
    expect(snapshots).toHaveLength(1); // the mutation response applied
  });

  it("a mid-body text() rejection maps to the unreachable-server result — the helper never rejects", async () => {
    const h = makeHarness();
    const { client, respondWith } = h;
    const snapshots: AppState[] = [];
    client.onSnapshot((snap) => snapshots.push(snap));
    client.start();
    h.latestSocket()!.messageIt(snapshotJson({ activeStackId: "s1" }));
    const before = client.getSnapshot();

    respondWith({
      ok: true,
      status: 200,
      text: (): Promise<never> => Promise.reject(new TypeError("aborted mid-body")),
    });
    const result = await client.pushNote("s1", "hello");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/reach the server/i);
    expect(snapshots).toHaveLength(1); // nothing applied
    expect(client.getSnapshot()).toBe(before);
  });
});
