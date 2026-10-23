import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { getAppState } from "./state.js";

/**
 * Registers the WebSocket sync channel (`/api/ws`) per PLAN.md ("WebSocket
 * sync") and DECISIONS.md §9: on connect the server sends the full state;
 * after every successful mutation all connected sockets receive the fresh
 * full snapshot. No auth (DECISIONS.md §9 — fully open single-user server),
 * no heartbeats, inbound messages ignored (v1 clients never send).
 */
export async function registerWs(app: FastifyInstance, db: DatabaseSync): Promise<void> {
  // The plugin must register before any route that needs `websocket: true`;
  // the app-level onSend hook below is also scoped over everything the
  // instance serves.
  await app.register(websocket);

  // Every currently-open client socket. The Set gives O(1) removal on
  // close/error and deterministic per-connection broadcast order.
  const clients = new Set<WebSocket>();

  /**
   * Broadcast via a single app-wide `onSend` hook rather than per-route
   * calls: the done-when demands sequential mutations never miss broadcasts,
   * and a hook over the whole app means no route can forget, and any
   * mutation route added later is covered automatically.
   *
   * The hook fires after the handler returns the payload but before it is
   * written to the HTTP response, so the string sent to every socket here is
   * the EXACT serialized payload the mutating HTTP client receives —
   * byte-identical (the app.ts contract), and it avoids recomputing
   * getAppState a second time.
   */
  app.addHook("onSend", async (request, reply, payload) => {
    // Filter: mutations only (POST/PUT/PATCH/DELETE), successful ones
    // (2xx), API-scoped, with a non-empty serialized string payload.
    // GETs never match (so /api/state, /api/health and /api/ws itself
    // never broadcast); other verbs (OPTIONS etc.) do not exist on this
    // app anyway; error bodies (400/404) never match — a failed
    // validation is not a state change and must replay to no socket.
    const mutating =
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH" ||
      request.method === "DELETE";
    const successful = reply.statusCode >= 200 && reply.statusCode < 300;
    const apiScoped = request.url.startsWith("/api");
    const hasSnapshot = typeof payload === "string" && payload.length > 0;
    if (!mutating || !successful || !apiScoped || !hasSnapshot) return payload;

    for (const socket of clients) {
      // readyState guard: a socket can be CLOSING/CLOSED in the gap
      // between the "close" event firing and its removal from the set
      // (events queue on the event loop). Sending to a closed socket
      // would throw.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
    return payload;
  });

  app.get("/api/ws", { websocket: true }, (socket) => {
    // Full snapshot immediately: a client connecting mid-stream gets current
    // truth without waiting for the next mutation to learn about the world.
    // Same readyState guard as the broadcast loop: between the server-side
    // upgrade handshake completing and this callback running a client could
    // already have disconnected — sending to a closed socket would throw.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(getAppState(db)));
    }
    clients.add(socket);

    socket.on("close", () => {
      clients.delete(socket);
    });

    // ws emits "error" on protocol/transport failures, and an EventEmitter
    // with no error listener throws an unhandled error that crashes the
    // process. A dropped client must never take the server down — remove it
    // from the set and swallow the cause.
    socket.on("error", () => {
      clients.delete(socket);
    });
  });
}
