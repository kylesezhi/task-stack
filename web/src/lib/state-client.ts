/**
 * Framework-agnostic WS + REST state client (T15).
 *
 * Contract it codes against (server/src/ws.ts, T12):
 * - On connect the server sends ONE text message: the full JSON AppState.
 * - After every successful mutation the server broadcasts the EXACT HTTP
 *   response payload (byte-identical) to all sockets; nothing else is ever
 *   sent and inbound messages are ignored (v1 clients never send).
 * - No heartbeats (accepted v1 limitation) — reconnect on close/error only.
 *
 * Framework-free (no Svelte, no window/document at module scope) so it imports
 * cleanly in Node under vitest and in the real-server smoke; the Svelte layer
 * lives in store.ts. Server truth is authoritative: snapshots are replaced
 * wholesale, never merged (DECISIONS.md §11 — no deltas, no optimistic UI).
 */
import type { AppState } from "@task-stack/shared";

export type ConnectionStatus = "connecting" | "online" | "offline";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** Minimal socket surface this client actually uses (browser-shaped). */
export interface WebSocketLike {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

/** Minimal fetch surface for mutations (Response subset + narrow init). */
export interface FetchLike {
  (
    // `this: void`: fetch must never be invoked method-style. Browsers
    // brand-check native fetch and throw `TypeError: Illegal invocation` for
    // any receiver other than the window (Node doesn't, which is exactly why
    // tests alone masked it) — so the contract categorically rejects a bound
    // receiver for every implementation, not just the default.
    this: void,
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export interface BackoffOptions {
  /** Delay before the first reconnect attempt (before attempt 1). */
  initialMs: number;
  /** Exponential delay growth per consecutive failure. */
  factor: number;
  /** Upper bound on the per-attempt delay. */
  maxMs: number;
}

export interface StateClientOptions {
  wsUrl: string;
  /** Default: `new WebSocket(url)` — cast once at this single boundary. */
  createSocket?: (url: string) => WebSocketLike;
  /** Default: global fetch (satisfies FetchLike structurally). */
  fetchImpl?: FetchLike;
  /** Default: 1s initial, doubling, capped at 30s. */
  backoff?: BackoffOptions;
}

const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1000, factor: 2, maxMs: 30000 };

/**
 * Minimal shape check (not full validation): every snapshot — connect, WS
 * broadcast, or mutation response — must carry the four AppState members with
 * the right primitive kinds before it replaces the current one. Deep checks on
 * Stack/Note live in `shared` (zod) where bodies are WRITTEN; here snapshots
 * are only ever READ, so a shallow gate against garbage is enough.
 */
function isAppState(value: unknown): value is AppState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["activeStackId"] !== null && typeof candidate["activeStackId"] !== "string") {
    return false;
  }
  return (
    Array.isArray(candidate["stacks"]) &&
    Array.isArray(candidate["notes"]) &&
    Array.isArray(candidate["completed"])
  );
}

export class StateClient {
  private started = false;
  private status: ConnectionStatus = "offline";
  private snapshot: AppState | null = null;
  /** Last applied raw message string — the dedupe key (T12 byte-identical
   * guarantee makes REST response vs WS broadcast collide here by design). */
  private lastRaw: string | null = null;
  private socket: WebSocketLike | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Consecutive failed attempts since the last successful open — drives the
   * backoff delay. Reset to 0 on every successful open. */
  private consecutiveFailures = 0;
  private readonly wsUrl: string;
  private readonly backoff: BackoffOptions;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly fetchImpl: FetchLike;
  private readonly snapshotListeners = new Set<(s: AppState) => void>();
  private readonly statusListeners = new Set<(st: ConnectionStatus) => void>();

  constructor(options: StateClientOptions) {
    this.wsUrl = options.wsUrl;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    // Receiver-safe default: the arrow calls bare `fetch(...)` with no
    // receiver, satisfying brand-checking native fetch in browsers and Node
    // alike — `this.fetchImpl = fetch` would invoke it method-style and throw
    // "Illegal invocation" in every real browser.
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** Idempotent: a second call is a no-op (the app singleton starts once). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.setStatus("connecting");
    this.openSocket();
  }

  /** Prevents any reconnect, clears the reconnect timer, closes the socket.
   * For tests and teardown; the app singleton never calls this. */
  stop(): void {
    this.clearReconnectTimer();
    this.started = false;
    this.consecutiveFailures = 0;
    if (this.socket !== undefined) {
      const socket = this.socket;
      this.socket = undefined;
      try {
        socket.close(); // the trailing close event may still arrive
      } catch {
        // An already-dead socket's close() can throw — nothing left to clean.
      }
    }
    this.setStatus("offline");
  }

  getSnapshot(): AppState | null {
    return this.snapshot;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Returns an unsubscribe function; listeners are notified synchronously. */
  onSnapshot(listener: (s: AppState) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onStatus(listener: (st: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ---- WS lifecycle -------------------------------------------------------

  private openSocket(): void {
    // A status listener may call stop() synchronously during the "connecting"
    // notification (from start() or the reconnect timer) — stop must win: no
    // socket may be created afterwards. The only call paths that legitimately
    // reach here (start() after `started = true`, and the retry timer after
    // its own re-check) are unaffected by this guard.
    if (!this.started) return;
    this.clearReconnectTimer(); // never two pending reconnects
    // Stop→start in the same tick can leave a socket behind; close it before
    // opening a new one — its trailing events are inert (identity guards).
    if (this.socket !== undefined) {
      const stale = this.socket;
      this.socket = undefined;
      try {
        stale.close();
      } catch {
        // An already-dead socket's close() can throw — nothing left to clean.
      }
    }
    try {
      const socket = this.createSocket(this.wsUrl);
      this.socket = socket;
      // Identity guards: events from a socket that is no longer the live one
      // (abandoned by stop() then start(), or by openSocket() closing a
      // leftover) must not clobber state. Notably a trailing close from an
      // OLD socket used to run handleClose, which blindly set
      // `this.socket = undefined` and destroyed the NEW live socket.
      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        this.handleOpen();
      });
      // Reconnect ONLY on close: browsers always fire close after error, so
      // wiring both would double-schedule (guarded anyway, but one path is
      // simpler and sufficient).
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.handleClose();
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        this.handleMessage(event);
      });
    } catch {
      // Defensive: a factory throw (bad URL etc.) counts as a failed attempt
      // so backoff still paces the retry instead of dying silently.
      this.handleClose();
    }
  }

  private handleOpen(): void {
    this.consecutiveFailures = 0; // a successful open resets the backoff
    this.setStatus("online");
  }

  private handleClose(): void {
    this.socket = undefined;
    if (!this.started) {
      this.setStatus("offline");
      return;
    }
    this.consecutiveFailures += 1;
    this.setStatus("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started) return; // stop() cancelled the loop — never reconnect
    if (this.reconnectTimer !== undefined) return; // double-scheduling guard
    const { initialMs, factor, maxMs } = this.backoff;
    const delay = Math.min(initialMs * factor ** (this.consecutiveFailures - 1), maxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      // A listener may have called stop() synchronously during the "offline"
      // notification that preceded this timer being scheduled — re-check.
      if (!this.started) return;
      this.setStatus("connecting");
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  // ---- Snapshot delivery --------------------------------------------------

  private handleMessage(event: { data: unknown }): void {
    // Server sends text only; a non-string datum (a stray Blob, say) is not
    // state — ignore it.
    if (typeof event.data !== "string") return;
    this.apply(event.data);
  }

  /**
   * Parses + shape-checks `raw`, then replaces the snapshot wholesale.
   * Bad JSON / wrong shape are ignored silently: state stays intact, no
   * notify, no crash — a garbage frame must never take the UI down.
   */
  private apply(raw: string): void {
    if (raw === this.lastRaw) return; // byte-identical → already applied
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isAppState(parsed)) return;
    this.snapshot = parsed;
    this.lastRaw = raw;
    this.notifySnapshot();
  }

  private notifySnapshot(): void {
    for (const listener of [...this.snapshotListeners]) listener(this.snapshot!);
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of [...this.statusListeners]) listener(next);
  }

  // ---- Mutations ----------------------------------------------------------

  /**
   * Runs one mutation against the REST API and applies the fresh snapshot
   * from the response body. Per T12 the body is byte-identical to the WS
   * broadcast that follows, so applying it here (and updating lastRaw) makes
   * the broadcast a no-op dedupe — one apply per mutation, no double notify.
   */
  private async request(method: string, path: string, body?: unknown): Promise<MutationResult> {
    const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }

    let response: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      // Detached local: calling `this.fetchImpl(path, init)` would hand the
      // function the StateClient instance as receiver — brand-checking native
      // fetch (browsers) throws `TypeError: Illegal invocation` for that. An
      // unbound call (`this: void` per FetchLike) is safe for both native
      // fetch and injected plain functions.
      const fetchImpl = this.fetchImpl;
      response = await fetchImpl(path, init);
    } catch {
      return { ok: false, error: `Can't reach the server (${method} ${path} failed)` };
    }

    // A mid-body abort (text() rejection) is a network failure too — it must
    // map to the same unreachable-server result, never reject the helper
    // (every helper must resolve to a MutationResult; callers don't catch).
    // The catch covers the body read ONLY: an exception thrown by a snapshot
    // LISTENER below is a listener bug, not a network failure — the mutation
    // already succeeded server-side and the state was already applied, so
    // mapping it to "Can't reach the server" would invite a duplicating
    // retry; it propagates out of the helper instead (rejecting promise is
    // the honest signal).
    let text: string;
    try {
      text = await response.text();
    } catch {
      return { ok: false, error: `Can't reach the server (${method} ${path} failed)` };
    }

    if (!(response.ok && response.status >= 200 && response.status < 300)) {
      // Error body shape is `{ "error": string }` (server/errors.ts); anything
      // else degrades to the status code so the message is never empty.
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed?.["error"] === "string" && parsed["error"].length > 0) {
          return { ok: false, error: parsed["error"] };
        }
      } catch {
        // Not JSON → fall through to the generic status message.
      }
      return { ok: false, error: `HTTP ${response.status}` };
    }

    let parsed: unknown = undefined; // pre-assign: a parse throw leaves it unset
    try {
      parsed = JSON.parse(text);
    } catch {
      // Shape check below rejects undefined (not JSON / garbage) too.
    }
    if (!isAppState(parsed)) {
      // A 2xx that is not a snapshot is a contract violation — surface it,
      // but do NOT apply it and do NOT touch lastRaw (this raw is not state).
      return { ok: false, error: `Unexpected response body from ${method} ${path}` };
    }
    if (text !== this.lastRaw) {
      this.snapshot = parsed;
      this.lastRaw = text;
      this.notifySnapshot();
    }
    return { ok: true };
  }

  createStack(name: string): Promise<MutationResult> {
    return this.request("POST", "/api/stacks", { name });
  }

  updateStack(id: string, patch: { name?: string; position?: number }): Promise<MutationResult> {
    return this.request("PATCH", `/api/stacks/${encodeURIComponent(id)}`, patch);
  }

  deleteStack(id: string): Promise<MutationResult> {
    return this.request("DELETE", `/api/stacks/${encodeURIComponent(id)}`);
  }

  setActiveStack(stackId: string): Promise<MutationResult> {
    return this.request("PUT", "/api/active", { stackId });
  }

  pushNote(stackId: string, text: string): Promise<MutationResult> {
    return this.request("POST", `/api/stacks/${encodeURIComponent(stackId)}/notes`, { text });
  }

  editNote(noteId: string, text: string): Promise<MutationResult> {
    return this.request("PATCH", `/api/notes/${encodeURIComponent(noteId)}`, { text });
  }

  tossNote(noteId: string): Promise<MutationResult> {
    return this.request("DELETE", `/api/notes/${encodeURIComponent(noteId)}`);
  }

  completeNote(noteId: string): Promise<MutationResult> {
    return this.request("POST", `/api/notes/${encodeURIComponent(noteId)}/complete`);
  }

  reorderNotes(stackId: string, noteIds: string[]): Promise<MutationResult> {
    return this.request("PUT", `/api/stacks/${encodeURIComponent(stackId)}/notes/order`, {
      noteIds,
    });
  }
}
