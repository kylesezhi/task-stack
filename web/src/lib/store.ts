/**
 * Thin Svelte reactive layer over the framework-agnostic StateClient (T15).
 * Plumbing only: two stores piped from the client's listeners, plus the nine
 * mutation helpers re-exported for components. Correctness here is verified by
 * the browser smoke, not the unit suite (this file touches `location` at
 * module scope, so it can only load in a browser).
 */
import { writable } from "svelte/store";
import type { AppState } from "@task-stack/shared";
import { StateClient, type ConnectionStatus, type MutationResult } from "./state-client";

/**
 * Same-origin WS URL (vite dev proxies /api/ws with ws:true; production serves
 * same-origin from the Fastify process, T14). No query/auth — DECISIONS.md §9
 * open single-user server.
 */
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${location.host}/api/ws`;

export const client = new StateClient({ wsUrl });

/**
 * App-wide stores. Client truth flows one way (listener → store); components
 * never write back, they mutate through the helpers below.
 */
export const snapshot = writable<AppState | null>(null);
export const status = writable<ConnectionStatus>("connecting");

client.onSnapshot((s) => snapshot.set(s));
client.onStatus((st) => status.set(st));

// Module-scope start: the singleton serves the whole app and there is exactly
// one natural lifecycle (page load). stop() exists for tests, not for the app.
client.start();

export function createStack(name: string): Promise<MutationResult> {
  return client.createStack(name);
}

export function updateStack(
  id: string,
  patch: { name?: string; position?: number },
): Promise<MutationResult> {
  return client.updateStack(id, patch);
}

export function deleteStack(id: string): Promise<MutationResult> {
  return client.deleteStack(id);
}

export function setActiveStack(stackId: string): Promise<MutationResult> {
  return client.setActiveStack(stackId);
}

export function pushNote(stackId: string, text: string): Promise<MutationResult> {
  return client.pushNote(stackId, text);
}

export function editNote(noteId: string, text: string): Promise<MutationResult> {
  return client.editNote(noteId, text);
}

export function tossNote(noteId: string): Promise<MutationResult> {
  return client.tossNote(noteId);
}

export function completeNote(noteId: string): Promise<MutationResult> {
  return client.completeNote(noteId);
}

export function reorderNotes(stackId: string, noteIds: string[]): Promise<MutationResult> {
  return client.reorderNotes(stackId, noteIds);
}
