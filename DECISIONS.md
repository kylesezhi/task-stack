# task-stack — Design Decisions

Date: 2026-10-21 · Status: agreed (design interview complete) · Repo: empty at decision time

task-stack is a small web app for FILO task management: a stack of notes where only
the top note's text is readable. Push new notes on top; pop completed notes off,
revealing what's underneath. Hiding everything except the current item is the feature
— it kills decision fatigue and builds trust that everything below is accounted for.

Inspired by the "task stack" system described by Dave Gauer (https://ratfactor.com/stack/).
Concept credited; no text or artwork copied from that article.

## Decision tree — resolved

### 1. Purpose & audience
- **Personal tool, open source.** Built for the owner's daily use first; MIT-licensed and
  structured so anyone can run their own instance.
- Rejected: private-only (no reason to hoard it), public multi-tenant product (accounts,
  hosting costs, support — not worth it), portfolio/learning project (utility is primary).

### 2. Scope of stacks
- **Multiple stacks, uniform behavior.** Users create as many stacks as they want
  ("work", "personal", "kitchen rennovation"). One stack is **globally active**
  (server-truth): switching stacks on any device switches all devices via WebSocket.
- The article's task-stack vs. project-stack distinction (quick vs. ceremonial friction)
  was considered and **deliberately dropped for v1** — all stacks behave the same: fast.
  The distinction can return later as a per-stack friction setting if experience demands it.
- Rejected: per-device active stacks (the article's "one active stack per time and place"
  argues for it, but a single global pointer is simpler and honest for one user).

### 3. Visibility model (the core UX)
- **Skeuomorphic growing stack.** The top note is fully readable. Each buried note peeks
  out as a paper edge with a slight **stable pseudo-random rotation/offset** (derived
  deterministically from the note's id — stable across reloads and devices, zero storage).
- The stack **visibly grows** with depth — you *feel* how much is in there without reading
  any of it. Depth trust without a list.
- Deep stacks cap visible edges (~15) with a "+N" tag so 100-note stacks don't wreck the layout.
- Reading/reordering buried notes: an explicit **"open" action flips to a plain list view**
  (all notes readable, drag-to-reorder, edit, toss). One click to open, one to close.
- Rejected: fan-out skeuomorphic reorder (prettier but fiddlier than a list); strictly-one-item
  with no access (real life requires pulling obsolete items from the middle).

### 4. Lifecycle actions (v1)
- **Push** — quick-add input puts a new note on top of the active stack.
- **Pop** — complete the top note → full ceremony animation → note moves to the archive.
- **Toss** — delete a note quietly (no ceremony, no archive credit) for items that became
  irrelevant. Instant, no confirm; accidental toss = retype (consistent with no-undo below).
- **Edit** — change a note's text (top note or in list view).
- **Reorder** — drag in the list view; instant, no confirmation.
- **Delete stack** — allowed with pending notes; pending notes are destroyed, archived
  (completed) notes survive with the stack's name recorded. A confirm guards this one.
- Rejected: **undo** (popping should feel final — the ritual is the point); **set-aside
  shelf** (for externally-blocked tasks — YAGNI, re-add if felt); **peek single note**
  (the open-list covers it).

### 5. Note content
- **Plain text, one field** — title-length, like a real sticky note. Created/completed
  timestamps are stored for the archive.
- Rejected: title+body, tags, colors-as-user-choice, due dates. Purity is the product.
  (Note *visual* colors exist — see §8 — assigned deterministically, not chosen.)

### 6. Done archive
- **One global plain dated list**, newest first, showing which stack each note came from.
  All stacks' completions share one pile.
- The pop ceremony remains elaborate (see §7); the *archive browsing* is deliberately plain.
- Rejected: flip-through skeuomorphic pile, constellation night-sky view (poetic, deferred
  indefinitely; see PLAN.md "Deferred").

### 7. The pop ceremony (emotional centerpiece)
- **Full ritual animation**: the note lifts off the stack → crumples → burns → drifts away
  as the next note is revealed beneath. Hand-crafted CSS keyframes + SVG filters (crumple
  via feTurbulence/displacement, burn via mask), no animation library.
- Toss gets a brief quiet crumple. No fire for quitters.
- Empty stack state: calm completion — a still surface, one quiet line of copy, one faint
  add affordance. Being done is allowed to feel like rest, not a hole.

### 8. Visual identity
- **Warm paper skeuomorphism**: post-it yellows plus a few sibling colors (assigned
  deterministically per note from id hash — variety without a picker), subtle paper grain
  (SVG turbulence), soft shadows, slight rotations, calm desk-like background.
- **Caveat** (OFL, self-hosted) as the handwritten font for v1. Roadmap: replace with a
  font made from the owner's own handwriting.
- **Light-only for v1**, but all colors flow through CSS custom properties so a dark
  "evening desk" theme can slot in without refactor.
- Microcopy: **quietly playful** — small dry asides, never exclamation-mark energy.
  All copy written fresh; nothing lifted from the source article.

### 9. Data, server, sync
- **Single-user server, no auth, fully open.** Anyone who can reach the URL can edit the
  stacks — accepted risk. Deployment hygiene: don't publicize the URL, send `X-Robots-Tag:
  noindex`, avoid the origin appearing in any repo docs.
- **TypeScript + Node (Fastify) + `node:sqlite`** (Node's built-in module, release
  candidate since 24.15; chosen over better-sqlite3 on 2026-10-22 for a
  zero-native-module runtime and the smallest Docker image). One language across
  the repo; types shared with the frontend via a `shared/` workspace package.
- **SQLite** single-file storage; nightly backup = file copy + `GET /api/export` JSON dump.
- **WebSocket broadcast sync**: every mutation → server broadcasts the full state snapshot
  to all connected clients. State is tiny (hundreds of notes max); no delta logic, no
  conflict handling, always authoritative.
- Hosting: the owner's existing VPS/home box via **Docker** — minimal multi-stage
  image (no native modules), compose with a persistent volume for `data.db`;
  Caddy + TLS if a domain is handy (optional — no PWA in v1, so no HTTPS
  requirement).

### 10. Platform & offline
- **Responsive web app, desktop + mobile; no PWA in v1.** PWA (manifest, service worker,
  offline read-only snapshot) was chosen then **deferred** — it imposed an HTTPS/domain
  requirement and offline-caching work not wanted for v1. Add in v2 if the app earns it.
- v1 is online-only: the server is required for reading and writing.

### 11. Tech stack
- **Svelte 5 + Vite** frontend (built-in spring/tween transitions fit the paper physics),
  **hand-written CSS** (the aesthetic is bespoke; utility frameworks add nothing here),
  CSS/SVG animation only.
- Repo: **pnpm workspaces** — `web/`, `server/`, `shared/` (shared TS types); toolchain
  managed by **mise** (`mise.toml` pins node + pnpm; mise is the only global
  prerequisite).
- Tests: **Vitest** units for stack-ordering logic + API handlers; **Playwright** e2e smoke
  (push from one browser context, watch it arrive in another via WS; push→pop→archive flow).
- Evergreen browsers only; full keyboard reachability (`/` focuses input, Enter pushes,
  Esc clears); `aria-live` for stack changes.

### 12. Identity
- Name: **task-stack** (matches the repo folder). License: **MIT**.
- README credits the originating article as inspiration (concept credit only).
