# task-stack — UI Design Brief

A UI-only spec for generating mockups (e.g., Google Stitch). It describes what the
user sees and feels. Nothing in here is about implementation — no data, servers,
or code. Tip: feed the style block (§2) plus one screen at a time (§5) rather than
the whole document at once.

## 1. What this app is

A calm, tactile task manager built on a single idea: **a stack of sticky notes
where only the top note is readable.** New tasks are pushed on top (interruptions,
dependencies — whatever reality just dumped on you). Finishing the top note pops
it off in a small ritual — the note lifts, crumples, burns, and drifts away —
revealing the next task beneath.

The stack visibly grows as notes accumulate: each buried note peeks out as a
tilted paper edge, so you *feel* the depth without reading any of it.

This is deliberately **not** a to-do list app. There are no tags, no dates, no
checkboxes, no priorities, no projects-with-subtasks. One note at a time.

## 2. Visual style (use with every screen)

**Aesthetic:** warm paper skeuomorphism. A tidy, quiet desk with a single stack
of mini sticky notes as the centerpiece. Hand-made feeling, generous whitespace,
nothing glowing, glassy, neon, or brutalist.

**Color palette — intentionally unspecified:** this brief pins no specific
colors. Propose a full palette (desk, note set, inks, primary action, chips)
that serves the warm, light, paper aesthetic.

**Desk/background:** light, warm desk tones (off-white papers/linens), soft
ambient light, very subtle vignette. The stack is the only "loud" thing on
screen.

**Note colors:** a small sticky-note palette with a few sibling colors for
variety. Each note gets exactly one color from the palette, assigned
automatically; no user-facing color picker.

**Note material:** subtle paper grain, a faint glue-strip sheen along the top
edge (like a real post-it), slightly darker 1px paper edge, soft layered
drop-shadow so the top note lifts off the pile.

**Placement feels hand-placed, never gridded:** every note carries a slight
tilt (±2–6°); buried edges alternate peeking left/right, each offset 6–10px —
never a perfect stack, never a card grid.

**Typography:**
- Note text: **Caveat** (handwritten, Google font; any warm marker-style
  handwritten font in a pinch), large — the top note is readable from across a
  desk (think 26–32px on desktop).
- Everything else (labels, buttons, archive metadata, microcopy): a quiet small
  sans-serif (Inter or similar), muted ink tones.

**Buttons/controls:** quiet and few. Primary action ("Done") is a rounded
button in one clearly-primary color — the single strong accent on screen.
Secondary actions are ghost/underline text buttons in quiet muted ink.
Line icons only, used sparingly.

**Text/ink:** warm near-black ink for note text; muted ink for secondary text.

**Light mode only.** Airy, calm, no dark theme.

## 3. Core components

- **Top note card** — square mini sticky (~300–340px desktop), slightly tilted,
  handwritten text, one palette color, lifted off the pile by its shadow.
- **Peeking edges** — partial notes behind the top note, each tilted a little
  more, alternating sides, showing only a sliver of paper. They suggest buried
  tasks; no text is visible on them.
- **"+N more" scrap** — a tiny tilted paper scrap near the bottom edge for deep
  stacks (e.g., "+25 more").
- **Quick-add input** — below the stack; styled like a blank note. Placeholder:
  "Write it down, stick it on top." Small hint: "/ to focus · Enter to push".
  One "Push" button.
- **Action row** — under the top note: **Done** (primary), **Edit**
  (ghost), **Toss** (quietest ghost).
- **"See all" link** — a quiet text link near the stack ("See all 8") that
  opens the list view.
- **Stacks drawer** — a paper sheet that slides in from the left, listing all
  stacks.
- **Archive list** — a plain, dated list view of everything ever completed.
- **Stack pictogram** — a tiny 3-layer sticky-note glyph for drawer rows.

## 4. Screen inventory

Five screens: **Stack View** (home), **List View** (open the stack),
**Stacks Drawer**, **Archive**, **First Run**. Plus one motion sequence
(the pop ceremony).

## 5. Screens

### 5.1 Stack View — the home screen

The ambient home: exactly one readable task, everything else felt, not read.

**Desktop layout:** minimal top chrome — a small "Stacks" button top-left, the
active stack name quiet-center ("Work" with a tiny "8 notes" underneath), a
small "Archive" button top-right. Center stage: the stack (top note + peeking
edges + "+N more" scrap if deep). Below the stack: the action row (Done / Edit /
Toss), then the "See all 8" link, then the quick-add input at the bottom of the
flow. Generous whitespace everywhere else.

**Mobile layout:** slim top bar (stacks menu, stack name, archive); the stack
fills the middle of the screen; Done/Edit/Toss row directly under the note;
quick-add input pinned to the bottom, thumb-reachable. Big "Done" target.

**States to mock:**
- *One note* — a single note, no edges.
- *Typical (8 notes)* — top note + ~7 peeking edges, stack name shows
  "8 notes".
- *Deep (40 notes)* — edges capped at ~15 visible, "+25 more" scrap near the
  bottom.
- *Empty* — a bare desk, a faint ghost outline where the stack was, one quiet
  line: "The stack is empty." Plus the quick-add input. No confetti, no shame,
  no big illustration. Being done should look like rest.

### 5.2 Pop ceremony — motion sequence (render as 4–6 frames)

The emotional payoff, the app's signature moment. The user taps **Done**:

1. The top note lifts off the stack and hovers a moment.
2. It crumples — corners fold in, it balls up.
3. It catches fire from one edge — warm flame, ember glow (not scary, not an
   error tone — a celebration).
4. It burns down into drifting sparks/embers that fade upward.
5. The note beneath is revealed and settles with a tiny bounce — the new
   current task.

### 5.3 List View — "open the stack"

Reality maintenance: reading and rearranging what's buried.

A paper sheet slides over the desk. Header: "Work — 8 notes" + a "Close"
control. Rows in stack order (top of stack first): drag handle (⠿), handwritten
note text, small quiet row actions on hover/focus (edit pencil, toss ×).
Deliberately plain: a **flat list** — no dates, no checkboxes, no indentation,
no grouping, no sub-items.

Empty state: "Nothing buried. Lucky you."

### 5.4 Stacks Drawer

Create, switch, and manage stacks. One stack is active at a time.

A paper sheet slides in from the left over the desk. Rows: tiny stack
pictogram, stack name, note count ("7"); the active stack is highlighted (a
folded-corner marker). Each row has a kebab menu: Rename, Delete. Deleting a
stack with notes shows a confirm modal: "Delete 'Work'? Its 7 notes go with
it. Completed notes stay in the Archive." — Cancel / Delete. Footer: a
"+ New stack" input ("Name this stack").

### 5.5 First Run — the very first screen ever

No chrome at all. Centered on the empty desk: a quiet heading — "What's this
stack for?" — one input, one "Create stack" button, and one small line of
explanation: "One note at a time. The top of the stack is the only thing to
do."

### 5.6 Archive

The proof of accomplishment — deliberately plain.

Quiet top bar: "Archive" and a total ("214 done"). Grouped by day (Today,
Yesterday, Oct 14 …). Rows: handwritten note text in slightly faded ink, a
small stack-name chip ("Work"), and a time ("11:42"). Newest first. No stats,
no charts, no streaks — the plainness is the point.

Empty state: "Nothing done yet. Push something."

## 6. Microcopy voice

Quietly playful: small dry asides, never exclamation marks, never scolding,
never corporate-cheerful. All examples above set the register.

## 7. Motion summary

- **Push:** the new note drops in and slaps on with a springy bounce, tilting
  into place.
- **Pop:** the full ceremony (§5.2) — the one big moment in the app.
- **Toss:** a quick crumple and the note drops out of frame. No fire for
  tossed notes.
- **Open/close list & drawers:** paper sheets slide.
- **Switching stacks:** the old stack fades/slides away, the new one settles
  in with a small bounce.
- **Reduced motion:** every animation becomes a simple fade.
- **Empty stack:** total stillness — nothing moves.

## 8. Responsive behavior

Desktop-first: ambient, centered, the stack at center stage with generous
whitespace. Mobile: identical components, stack filling the screen, input
pinned to the bottom, thumb-friendly Done button.

## 9. Do NOT include (critical)

This is not a to-do app — resist the clichés:

- No checkboxes, completion marks, or strike-throughs in the list view.
- No due dates, dates on notes, or calendars.
- No tags, labels, categories, or priority flags/colors-as-priority.
- No progress bars, streaks, stats, or charts.
- No notifications, badges, or toasts (especially no "undo" toast).
- No search, no multi-select, no bulk actions.
- No avatars, accounts, login, or settings page.
- No nested/indented sub-tasks or trees.
- No kanban board, note grid, or card wall — there is exactly ONE readable
  note per stack; everything else is edges.
- No dark mode, no gradients, no glassmorphism, no 3D.
- No onboarding carousel, tutorial overlays, or chatbot.
