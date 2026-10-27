# task-stack — v1 Implementation Tasks

Decomposition of the v1 plan into small-to-medium, verifiable tasks in dependency
order. Sources of truth (in the repo at `/home/kyle/Dropbox/opensource/task-stack/`):
`DECISIONS.md` (design decisions), `PLAN.md` (data model, API, milestones),
`DESIGN.md` (UI brief).

## How to use

- Checkboxes: `[ ]` not started · `[/]` in progress · `[x]` done.
- A task is done **only when its "Done when" verification passes** — no eyeball-only
  completions except where visual review is explicitly the verification.
- Sizes: **S** ≈ under an hour · **M** ≈ half a day.
- Phases are ordered (phase N needs phase N−1); `Depends` lists task-level
  prerequisites within/between phases.
- Toolchain: **mise is the only prerequisite** — `mise install` provisions the
  pinned node + pnpm from `mise.toml`.
- External inputs (things only you can provide) are flagged ⚠.

## Task index

| Phase | Contents |
|---|---|
| 0 · Scaffold | T01–T06 — monorepo, packages, lint, test harness |
| 1 · Server | T07–T14 — SQLite, API routes, WebSocket sync, export |
| 2 · Web mechanics | T15–T22 — state client, all views working (ugly CSS), e2e |
| 3 · Stack visuals | T23–T28 — paper aesthetic, growing stack, push animation |
| 4 · Ceremony & polish | T29–T33 — pop ritual, toss, empty state, a11y |
| 5 · Deploy & ship | T34–T39 — prod build, minimal Docker image, compose, backups, README, exit review |

---

## Phase 0 — Scaffold

- [x] **T01 · Initialize pnpm monorepo + mise toolchain** — S
  `mise.toml` pinning `node` and `pnpm` (e.g. `node = "24"`, `pnpm = "12"`);
  root `package.json`, `pnpm-workspace.yaml` (`web`, `server`, `shared`),
  `.gitignore` (node_modules, dist, `server/data.db`, .env), `.editorconfig`.
  **Done when:** on a machine with only mise installed, `mise install && pnpm
  install` exits 0 and `pnpm -r ls` lists all three packages.
  Depends: —

- [x] **T02 · `shared` package with core types** — S
  TS package exporting `Stack`, `Note`, `CompletedNote`, `AppState` (shapes per
  `PLAN.md` data model) via `tsc` build.
  **Done when:** `pnpm --filter shared build` emits `dist/`; types import cleanly
  from a scratch script.
  Depends: T01

- [x] **T03 · `server` skeleton (Fastify)** — S
  App factory + `GET /api/health` returning `{ok:true}`; dev script (tsx).
  **Done when:** `pnpm --filter server dev` boots; `curl /api/health` returns
  `{"ok":true}`.
  Depends: T01

- [x] **T04 · `web` skeleton (Svelte 5 + Vite)** — S
  Vite + Svelte 5 + TS app; dev proxy `/api` → server; stub component fetches
  `/api/health` and shows the result.
  **Done when:** `pnpm --filter web dev` serves a page displaying the health
  status fetched through the proxy.
  Depends: T01, T03

- [x] **T05 · Lint + format** — S
  ESLint (flat config) + Prettier across all packages; root `lint`/`format`
  scripts.
  **Done when:** `pnpm lint` reports zero errors across all three packages.
  Depends: T02, T03, T04

- [x] **T06 · Vitest harness** — S
  Vitest configured in `shared` and `server`; one trivial passing test each.
  **Done when:** `pnpm -r test` is green.
  Depends: T02, T03

## Phase 1 — Server mechanics

- [x] **T07 · SQLite + schema (`node:sqlite`)** — M
  Built-in `node:sqlite` module (`DatabaseSync` — no third-party driver, needs
  Node ≥ 24.15 per `mise.toml`); DB path via env (`server/data.db` default);
  on boot create tables per `PLAN.md` (stacks, notes, completed_notes,
  settings); WAL via `PRAGMA journal_mode = WAL`; foreign keys on.
  **Done when:** boot creates the DB; an integration test asserts all four
  tables and their columns exist.
  Depends: T03

- [x] **T08 · Payload validation (zod, in `shared`)** — S
  Schemas for every API body: create/rename stack, push note, edit text,
  reorder (array of ids), set active.
  **Done when:** `shared` unit tests accept valid samples and reject malformed
  ones (empty text, wrong types).
  Depends: T02

- [x] **T09 · `GET /api/state` snapshot** — M
  Returns `{ activeStackId, stacks[], notes[], completed[] }`: stacks by
  position, notes by position ascending (1 = top), completed newest first.
  **Done when:** integration test with a seeded fixture DB returns the exact
  expected JSON.
  Depends: T07

- [x] **T10 · Stack routes** — M
  `POST /api/stacks` (create + make active), `PATCH /api/stacks/:id` (name,
  drawer position), `DELETE /api/stacks/:id` (pending notes deleted; completed
  rows persist with `stack_name`), `PUT /api/active`.
  **Done when:** integration tests prove: create→becomes active; delete removes
  pending notes while completed rows survive with the stack name recorded;
  switching active updates settings.
  Depends: T08, T09

- [x] **T11 · Note routes** — M
  `POST /api/stacks/:id/notes` (push at position 1 in one transaction, others
  shift), `PATCH /api/notes/:id` (edit text), `DELETE /api/notes/:id` (toss),
  `POST /api/notes/:id/complete` (move to completed_notes with `stack_name` +
  `completed_at`), `PUT /api/stacks/:id/notes/order` (full rewrite in one
  transaction; reject if id set ≠ current set).
  **Done when:** integration tests assert ordering invariants after each
  operation; complete snapshots the stack name; reorder rejects stale/missing
  ids.
  Depends: T08, T09

- [x] **T12 · WebSocket sync** — M
  `/api/ws`: send full state on connect; after every mutation broadcast the
  fresh full state to **all** connected sockets; mutation HTTP responses also
  return the snapshot.
  **Done when:** integration test: two WS clients — client A pushes a note, both
  A and B receive identical updated snapshots; sequential mutations don't miss
  broadcasts.
  Depends: T09, T10, T11

- [x] **T13 · Export + noindex header** — S
  `GET /api/export` (full dump: stacks, notes, completed); `X-Robots-Tag:
  noindex` on server responses (open server hygiene per `DECISIONS.md` §9).
  **Done when:** `curl -I` shows the header; a test verifies export contains
  everything `/api/state` does.
  Depends: T09

- [x] **T14 · Serve built web in production mode** — S
  `@fastify/static` serving `web/dist` at `/`; port/host via env.
  **Done when:** `pnpm -r build && node server/dist/index.js` serves the built
  app with working `/api` routes in one process.
  Depends: T04, T07

## Phase 2 — Web mechanics (unstyled)

- [x] **T15 · State client** — M
  WS + REST client: connect, reconnect with backoff, expose the snapshot as a
  reactive store, mutation helpers.
  **Done when:** unit tests against a mocked WS pass; manual smoke against the
  real server updates the store.
  Depends: T12

- [x] **T16 · View state machine + app shell** — S
  Views: `firstRun | stack | list | drawer | archive`; nav wiring with
  placeholder components; Esc closes overlays.
  **Done when:** switching between placeholder views works; Esc behavior
  verified.
  Depends: T15

- [x] **T17 · First Run view** — S
  Zero stacks → centered create form (name + Create stack) per `DESIGN.md` §5.5;
  POST `/api/stacks`.
  **Done when:** e2e: fresh DB → create "Work" → app enters StackView; server
  state has exactly one active stack.
  Depends: T10, T16

- [x] **T18 · StackView mechanics** — M
  Top note text of active stack, note count, quick-add input + Push, Done →
  complete, Toss → delete, Edit → inline edit, "See all N" opens list.
  **Done when:** e2e: push → new note becomes top; Done → note removed, next
  note becomes top, archive entry exists; Toss removes; Edit changes text.
  Depends: T11, T15, T16

- [x] **T19 · ListView mechanics** — M
  All notes top-first; drag-to-reorder; per-row edit + toss; Close.
  **Done when:** e2e: reorder two notes → reload preserves new order; toss from
  the list removes the row.
  Depends: T11, T16, T18

- [x] **T20 · StacksDrawer mechanics** — M
  List stacks (name, count, active marker); create, rename, delete (confirm
  modal: "Its N notes go with it. Completed notes stay in the Archive."),
  switch active.
  **Done when:** e2e covers full drawer CRUD + switching; a second browser
  context sees the switch land via WS.
  Depends: T10, T15, T16

- [x] **T21 · ArchiveView mechanics** — S
  Global completed list, newest first, grouped by day, stack-name chips, times,
  empty state copy.
  **Done when:** e2e: completed notes appear in correct day groups; empty state
  shows "Nothing done yet. Push something."
  Depends: T09, T16

- [x] **T22 · Playwright e2e suite** — M
  Happy path (first run → create → push → pop → archive) and the two-context
  sync test.
  **Done when:** `pnpm --filter web test:e2e` green locally.
  Depends: T17, T18, T19, T20, T21

## Phase 3 — Skeuomorphic stack visuals

- [x] **T23 · Deterministic per-note randomness (shared)** — S
  Pure functions `tilt(id)`, `edgeOffset(id)`, `colorIndex(id, n)` — no
  `Math.random`, values stable across reloads/devices.
  **Done when:** shared unit tests: same id → same values; tilt within ±2–6°;
  offsets 6–10px alternating; colorIndex within bounds.
  Depends: T02

- [x] **T24 · Design tokens + self-hosted fonts** — M (palette source:
  `reference/stitch_task_stack_ui_brief/`)
  CSS custom properties (palette, spacing, shadows) extracted from the approved
  Stitch mockups; self-host Caveat + quiet sans via `@font-face` (bundled files,
  no CDN).
  **Done when:** browser network panel shows zero external font requests;
  tokens are the only color source in components.
  Depends: T23

- [x] **T25 · Note card component** — M
  Paper grain (SVG feTurbulence), glue-strip sheen, darker 1px edge, layered
  shadow, tilt/color via T23 helpers.
  **Done when:** visual review; reload → identical placement for the same
  note ids.
  Depends: T23, T24

- [ ] **T26 · Stack rendering with peeking edges** — M
  Top note readable + buried edges peeking (alternating sides, deterministic
  offsets); visible edges capped ~15; "+N more" scrap for deeper stacks.
  **Done when:** the three DESIGN.md §5.1 states (1 / 8 / 40 notes) render
  correctly and are stable across reload.
  Depends: T25

- [ ] **T27 · Push animation** — S
  New note drops in, slaps on with a spring bounce, tilts into place;
  `prefers-reduced-motion` → simple fade.
  **Done when:** visual review; reduced-motion emulation shows the fade
  fallback.
  Depends: T26

- [ ] **T28 · Responsive layouts** — M
  Desktop ambient-centered; mobile: stack fills view, input pinned bottom,
  thumb-sized Done.
  **Done when:** walkthrough at ~390px and ~1280px+ has no horizontal scroll
  and all controls reachable; visual review vs DESIGN.md §8.
  Depends: T26

## Phase 4 — Ceremony & polish

- [ ] **T29 · Pop ceremony** — M
  Per DESIGN.md §5.2: lift → crumple (SVG displacement) → burn (mask) →
  embers → reveal beneath. CSS/SVG only, no libraries.
  **Done when:** visual review of the full sequence; reduced-motion becomes a
  simple fade; performance spot-check stays smooth.
  Depends: T26, T18

- [ ] **T30 · Toss animation** — S
  Quick crumple + drop out of frame. No fire for tossed notes.
  **Done when:** visual review.
  Depends: T29

- [ ] **T31 · Empty stack state** — S
  Ghost outline where the stack was, "The stack is empty.", total stillness.
  **Done when:** matches DESIGN.md §5.1 empty state; nothing animates.
  Depends: T28

- [ ] **T32 · Sheet + list polish** — M
  ListView and StacksDrawer as sliding paper sheets; archive rows/chips per
  DESIGN.md §5.3–5.6.
  **Done when:** visual review of all three overlays against DESIGN.md.
  Depends: T19, T20, T21, T24

- [ ] **T33 · Microcopy + accessibility pass** — M
  All copy in the quietly-playful register (DESIGN.md §6); focus order; aria-live
  announcement when the top note changes; keyboard-only operation (`/` focuses
  input, Enter pushes, Esc closes/clears); axe scan.
  **Done when:** a keyboard-only walkthrough completes every core action
  (push/pop/toss/edit/reorder/switch); axe reports zero critical issues.
  Depends: T29, T30, T31, T32

## Phase 5 — Deploy & ship

- [ ] **T34 · Production build orchestration** — S
  Root `pnpm build` builds web + server; single process serves both; env config
  (`PORT`, `DB_PATH`).
  **Done when:** `pnpm build && node server/dist/index.js` works end-to-end on
  localhost.
  Depends: T14, Phase 4

- [ ] **T35 · Minimal Docker image** — M
  Multi-stage `Dockerfile`: builder installs the pinned toolchain from
  `mise.toml` (node + pnpm) and runs `pnpm build`; runtime stage copies only
  `server/dist`, production `node_modules`, and `web/dist` onto a minimal Node
  base (distroless preferred, alpine fine — no native modules since the server
  uses built-in `node:sqlite`). `.dockerignore` (data.db, node_modules,
  mockups, reference). Runs as non-root; `DB_PATH` points at a volume.
  **Done when:** `docker build` succeeds; container smoke run passes
  (`/api/health` 200, stack view served, a pushed note survives a restart via
  the volume); `docker image ls` reports ≤ 100 MB — record the measured size
  and trim via `docker history` if over.
  Depends: T34

- [ ] **T36 · Compose + ops** — M (Docker chosen; systemd dropped)
  `docker-compose.yml`: image from T35, persistent volume for `data.db`, port
  mapping, `restart: unless-stopped`. Deployment is manual via the docker CLI
  on the local VM: get the image there by hand (`docker save` → copy →
  `docker load`, or build on the VM), then `docker compose up -d`.
  **Done when:** service boots on the VM via documented manual steps, survives
  a reboot, `/api/health` returns 200.
  Depends: T35

- [ ] **T37 · Backups** — S
  Nightly job copying the SQLite file from the host volume (or via
  `docker compose cp`); README section documenting it plus the `/api/export`
  alternative.
  **Done when:** the job is installed and one manual run succeeds; a restore
  is tested once (put the DB back on the volume → state intact).
  Depends: T36

- [ ] **T38 · README + LICENSE final** — M
  What it is, screenshot (a ceremony GIF if possible), Docker-first self-host
  instructions, credit to the originating article, MIT license, open-server
  hygiene note (never publish the origin URL).
  **Done when:** a fresh clone builds and runs by following the README alone.
  Depends: T36

- [ ] **T39 · v1 exit review** — S
  Final checklist pass; docs updated to match reality (palette recorded back
  into `DECISIONS.md`, any drifted decisions noted).
  **Done when:** every item below is ticked.

### v1 exit criteria

- [ ] All checks green locally: typecheck, lint, unit tests, build, e2e
- [ ] Deployed on the VM with nightly backups verified once
- [ ] Core flows verified on the deployed instance: push / pop / toss / edit /
      reorder / stack CRUD / switch / archive
- [ ] README self-host verified from a fresh clone
- [ ] DECISIONS.md / PLAN.md / DESIGN.md reconciled with what was built

### Out of scope for v1 (do not build)

PWA/offline · auth/multi-user · dark mode · undo · tags/dates/reminders/recurring
· search · sub-items/nesting · set-aside shelf · sharing · animation libraries
· CI pipeline
