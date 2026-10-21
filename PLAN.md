# task-stack — Build Plan

Companion to `DECISIONS.md` (the resolved design tree). This file is the
implementation-facing spec: product shape, data model, API, milestones.

## Product in one paragraph

A warm, paper-skeuomorphic web app for FILO task management. The screen shows a
stack of sticky notes: only the **top note is readable**; every buried note peeks
out as an edge with a stable pseudo-random tilt, so the stack physically grows
with depth. Type and hit Enter to **push** a note on top (interruptions,
dependencies — whatever reality just dumped on you). Complete the top note to
**pop** it — a full ritual (lift, crumple, burn, drift) — revealing the next
note beneath. Multiple named stacks, one globally active at a time, kept in
sync across open tabs/devices via WebSocket. Completed notes land in one plain
dated archive. No tags, no dates, no undo, no accounts: one thing at a time.

## Data model (SQLite, `server/data.db`)

```sql
CREATE TABLE stacks (
  id          TEXT PRIMARY KEY,   -- uuid
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,   -- drawer order
  created_at  TEXT NOT NULL       -- ISO 8601
);

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,   -- uuid
  stack_id    TEXT NOT NULL REFERENCES stacks(id),
  text        TEXT NOT NULL,
  position    INTEGER NOT NULL,   -- 1 = TOP of stack, increasing downward
  created_at  TEXT NOT NULL
);

CREATE TABLE completed_notes (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  stack_id     TEXT,              -- nullable: survives stack deletion
  stack_name   TEXT NOT NULL,     -- denormalized at completion time
  created_at   TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,         -- 'active_stack_id'
  value TEXT NOT NULL
);
```

Semantics:
- Notes are ordered by `position` ascending; **1 is the top**. Push inserts at
  position 1 and increments the rest (single SQL transaction). Reorder writes
  the full id-order array for a stack in one transaction.
- Creating a stack makes it the active stack.
- Deleting a stack: pending notes are deleted with it; completed rows persist
  (guarded by a client-side confirm; `stack_name` keeps the archive readable).
- Toss = hard `DELETE` from `notes`. Pop = move row to `completed_notes`.

## API sketch (Fastify, prefix `/api`)

| Method & path | Purpose |
|---|---|
| `GET /api/state` | Full snapshot: `{ activeStackId, stacks[], notes[], completed[] }` |
| `POST /api/stacks` `{name}` | Create stack, make it active |
| `PATCH /api/stacks/:id` `{name?, position?}` | Rename / reorder drawer |
| `DELETE /api/stacks/:id` | Delete stack (pending notes die, archive stays) |
| `PUT /api/active` `{stackId}` | Switch the globally active stack |
| `POST /api/stacks/:id/notes` `{text}` | Push note on top of that stack |
| `PATCH /api/notes/:id` `{text}` | Edit note text |
| `DELETE /api/notes/:id` | Toss note |
| `POST /api/notes/:id/complete` | Pop note → `completed_notes` |
| `PUT /api/stacks/:id/notes/order` `{noteIds}` | Full reorder write |
| `GET /api/export` | Full JSON dump (backup / data ownership) |
| `WS  /api/ws` | Live sync (below) |

**WebSocket sync**: on connect the server sends the full state. Every mutation
commits to SQLite, then the server broadcasts the fresh full state snapshot to
*all* connected sockets. Clients render server state authoritatively — no
optimistic UI, no delta logic. (State is tiny; this is boring and robust.)

All mutation responses also return the fresh snapshot, so the mutating client
updates in the same round-trip as the WS broadcast.

## Frontend structure (Svelte 5, `web/`)

Routes are views, not URLs (single page, no router):

- **StackView (default)** — the skeuomorphic stack of the active stack.
  - Top note: fully readable (Caveat font, paper grain, soft shadow, slight
    tilt). Pop + toss + edit affordances on it.
  - Buried notes: edges peeking (6–10px) left/right alternating, tilt/offset
    derived deterministically from `hash(id)` → stable across devices/reloads.
    Cap ~15 visible edges, then a "+N" tag.
  - Quick-add input below the stack: `/` focuses it, Enter pushes, Esc clears.
    New note slaps on with a spring settle.
  - Pop triggers the ceremony: lift → crumple (SVG feTurbulence displacement)
    → burn (mask + ember keyframes) → drift away, revealing the note beneath.
  - Empty: calm still surface, one quiet line ("The stack is empty."), faint
    add affordance. No confetti, no shame.
- **ListView** ("open" action) — plain readable list of all notes in the
  active stack: drag-to-reorder, inline edit, toss. Close returns to StackView.
- **StacksMenu** — list stacks (name + note count), create/rename/reorder,
  delete (confirm — pending notes die), switch active.
- **ArchiveView** — plain dated global list, newest first, stack name shown.

Deterministic pseudo-randomness (tilt, offset, color index) lives in
`shared/random.ts`: `tilt(id)`, `offset(id)`, `colorIndex(id)` — pure functions
of the note id, unit-tested to be stable and bounded.

Note colors: small warm palette (post-it yellow + 3–4 siblings); color assigned
per note via `colorIndex(id)` — variety without pickers.

## Repo layout

```
task-stack/
├── DECISIONS.md · PLAN.md · README.md · LICENSE (MIT)
├── package.json (pnpm workspaces) · .github/workflows/ci.yml
├── shared/        # TS types + pure logic (ordering, tilt/color), consumed by web+server
├── server/        # Fastify + better-sqlite3 + WS; serves web/dist in production
└── web/           # Svelte 5 + Vite; hand-written CSS; e2e tests live here (Playwright)
```

CI (GitHub Actions): typecheck → lint → vitest (server + shared) → build web →
Playwright smoke against a real server instance.

## Milestones

**M0 — scaffold (repo boots)**
pnpm workspaces; Vite+Svelte 5+TS in `web/`; Fastify skeleton + one route in
`server/`; `shared/` types; vitest harness; ESLint/Prettier; CI; README stub
(name, credit-to-article note, MIT). Deliverable: `pnpm dev` serves a hello
stack view from a real server.

**M1 — mechanics, ugly CSS (usable tool)**
Full schema + every API route + WS broadcast; StackView (top note + quick-add +
pop/toss/edit); ListView (read/reorder/edit/toss); StacksMenu
(create/rename/delete/switch); ArchiveView (plain list); first-run experience
(create your first stack). Unit tests: push/pop/toss/reorder ordering invariants
(position gaps, transactional reorder, pop-moves-to-archive). E2E smoke: two
browser contexts — push in one, appears in the other; push→pop→archive flow.

**M2 — skeuomorphic stack (looks like the product)**
Paper aesthetic: note colors, grain, shadows, tilts; growing stack with peeking
edges (deterministic tilt/offset, edge cap + "+N"); push spring animation;
keyboard ("/", Enter, Esc); responsive mobile layout (stack + input fills view).

**M3 — ceremony + polish (feels like the product)**
Full pop ritual (lift → crumple → burn → drift → reveal); quiet toss animation;
calm empty state; archive styling; microcopy pass (quietly playful, all fresh
wording); accessibility (focus order, aria-live stack updates, reduced-motion
fallback: fade instead of ritual).

**M4 — deployment (lives on the box)**
`GET /api/export`; server serves `web/dist`; systemd unit **or** Dockerfile +
compose; optional Caddy reverse proxy + TLS (only if a domain is handy);
nightly backup note (cron: cp sqlite file); README final pass (screenshots,
credit, self-host instructions); deployment hygiene for the open server:
noindex header, origin never written into repo files.

## Non-goals (v1, by design)

Reminders, due dates, calendars, recurring tasks (philosophically unstackable);
tags/search; undo; auth/multi-user; sharing; offline support; PWA install;
dark mode (theme tokens ready, theme ships later); per-stack friction
("display" stacks — dropped; revisit only if daily use demands it).

## Deferred ideas (parked, not planned)

- Personal-handwriting font (replace Caveat — e.g., self-made via calligraphr.com).
- PWA v2: manifest + service worker + offline read-only snapshot (implies HTTPS).
- "Evening desk" dark theme (CSS tokens already in place).
- Per-stack friction setting (the quick/display split).
- Constellation archive view (completed notes as stars — poetic, costly).

## Suggested next step

M0. The design tree is fully resolved; nothing downstream is blocked.
