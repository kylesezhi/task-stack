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

As built (verified 2026-11-17): `server/src/db.ts` creates exactly these four
tables with exactly these columns (`CREATE TABLE IF NOT EXISTS`, idempotent on
reopen), plus `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` —
both verified rather than merely set on every file-backed open (the
`:memory:` test path skips WAL by design; foreign keys apply to every open).

## API sketch (Fastify, prefix `/api`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness probe: `{ok:true}` |
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

As built (2026-11-17): every successful mutation responds with the **fresh
full snapshot** — 201 on create, 200 otherwise. Errors are always
`{"error": "..."}` with **400 or 404 only** (validation failures use the first
zod issue's message; there is no 409/5xx path). Every response — `/api/*` and
the served static HTML alike — carries `X-Robots-Tag: noindex`. WS frames are
bare snapshots: inbound client messages are ignored, and there are no
heartbeats.

## Frontend structure (Svelte 5, `web/`)

Routes are views, not URLs (single page, no router):

- **StackView (default)** — the skeuomorphic stack of the active stack.
  - Top note: fully readable (Caveat font, paper grain, soft shadow, slight
    tilt). Pop + toss + edit affordances on it.
  - Buried notes: edges peeking (6–10px) on hash-derived sides, tilt/offset
    derived deterministically from a hash of the note's `id` → stable across
    devices/reloads (each note keeps its side forever; populated stacks still
    show both sides). 15 visible cards total — top note + 14 buried edges —
    then a "+N" tag (`+N` = count − 15).
  - Quick-add input below the stack: `/` focuses it, Enter pushes, Esc clears.
    New note slaps on with a spring settle.
  - Pop triggers the ceremony: lift → crumple (SVG feTurbulence displacement)
    → burn (mask + ember keyframes) → drift away, revealing the note beneath.
  - Empty: calm still surface, one quiet line ("The stack is empty."), faint
    add affordance. No confetti, no shame.
- **ListView** ("open" action) — plain readable list of all notes in the
  active stack: drag-to-reorder, inline edit, toss. Close returns to StackView.
- **StacksDrawer** (shipped name; matching `DESIGN.md` §5.4 — the plan's
  earlier "StacksMenu") — list stacks (name + note count), create, rename,
  delete (confirm — pending notes die), switch active. No reorder in the
  drawer: drawer order is server-side (`PATCH /api/stacks/:id` `position`),
  with deliberately no drag-reorder UI in v1.
- **ArchiveView** — plain dated global list, newest first, stack name shown.

Deterministic pseudo-randomness (tilt, edge peek, edge drop, color index)
lives in `shared/random.ts`: `tilt(id)`, `edgeOffset(id)`, `edgeDrop(id)`,
`colorIndex(id, paletteSize)` — pure functions of the note id, unit-tested to
be stable and bounded. As built: the hash is 32-bit FNV-1a plus a final
xor-shift avalanche, driving four decorrelated per-purpose streams (tilt,
horizontal edge peek, buried-edge vertical drop, color), no `Math.random`;
tilt magnitudes run [2,6)° and edge magnitudes [6,10)px.

Note colors: an eight-color warm palette (the original sketch — post-it
yellow + 3–4 siblings — landed as 8 sibling hues; recorded in
`DECISIONS.md` §8); color assigned per note via `colorIndex(id, 8)` —
variety without pickers.

## Repo layout

```
task-stack/
├── DECISIONS.md · PLAN.md · DESIGN.md · TASKS.md · DEPLOY.md · README.md ·
│   LICENSE (MIT)
├── mise.toml      # pinned toolchain (node 24.22.1 + pnpm 12.15.0) + mise run tasks
├── package.json (pnpm workspaces) · pnpm-workspace.yaml · pnpm-lock.yaml
├── eslint.config.mjs · .prettierrc.json · .prettierignore · .editorconfig
├── Dockerfile · .dockerignore · docker-compose.yml · .env.example
├── docs/            # capture.mjs (README asset capture) + images/ (stack.png,
│   │                # pop-ceremony.gif)
├── reference/       # stitch_task_stack_ui_brief/ — the tracked design mockups
│                    # (the T24 palette source)
├── shared/          # TS types + deterministic visual randomness + payload
│                    # validation schemas, consumed by web+server
├── server/          # Fastify + node:sqlite (built-in) + WS; serves web/dist in
│                    # production
└── web/             # Svelte 5 + Vite; hand-written CSS; e2e tests live here
                     # (Playwright)
```

## Milestones

**M0 — scaffold (repo boots)**
mise.toml toolchain (node + pnpm); pnpm workspaces; Vite+Svelte 5+TS in
`web/`; Fastify skeleton + one route in
`server/`; `shared/` types; vitest harness; ESLint/Prettier; README stub
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
`GET /api/export`; server serves `web/dist`; minimal multi-stage Docker
image (pure-JS runtime — no native modules, `node:sqlite` is built in) +
compose with a persistent volume for `data.db`; optional Caddy reverse proxy
+ TLS (only if a domain is handy); nightly backup note; README final pass
(screenshots, credit, self-host instructions); deployment hygiene for the
open server: noindex header, origin never written into repo files.

**As built (2026-11-17):** M0–M4 are built. Deltas from the text above — PWA
was deferred before M4 (per `DECISIONS.md` §10, so its HTTPS implication never
applied); the optional Caddy/TLS step was not used; the README's screenshot
and ceremony GIF were produced by `docs/capture.mjs`; the nightly backup note
stayed open as task T37. The full local gate set is green: `pnpm lint`,
972 unit tests (collected), `pnpm build`, svelte-check (0 errors / 0
warnings), 14/14 e2e specs; a fresh clone builds and runs via the README's
Run-from-source path, and the core flows were re-verified against that
production build (see T39 in `TASKS.md`). The README's Docker path is the one
unexecuted piece (no Docker daemon on the authoring machine without sudo —
the same fence T35/T36 recorded).

## Non-goals (v1, by design)

Reminders, due dates, calendars, recurring tasks (philosophically unstackable);
tags/search; undo; auth/multi-user; sharing; offline support; PWA install;
dark mode (theme tokens ready, theme ships later); per-stack friction
("display" stacks — dropped; revisit only if daily use demands it); CI pipeline.

## Deferred ideas (parked, not planned)

- Personal-handwriting font (replace Caveat — e.g., self-made via calligraphr.com).
- PWA v2: manifest + service worker + offline read-only snapshot (implies HTTPS).
- "Evening desk" dark theme (CSS tokens already in place).
- Per-stack friction setting (the quick/display split).
- Constellation archive view (completed notes as stars — poetic, costly).

## Suggested next step

Close the two owner-pending gates for v1 ship sign-off — everything else is
green (T39 in `TASKS.md`). On the owner's VM with a Docker daemon: run the
real `docker build` + `docker compose up -d`, then the `sudo reboot` survival
fence. Then T37: install the nightly backup job and test one restore. Finally,
walk the core flows (push / pop / toss / edit / reorder / stack CRUD / switch /
archive) on the deployed instance. The design tree is fully resolved; nothing
downstream is blocked.
