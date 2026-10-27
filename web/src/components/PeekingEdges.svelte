<script lang="ts">
  /**
   * The buried paper edges peeking out of the pile (T26; DESIGN.md §2/§3/
   * §5.1; mockup: stack_view_home's buried-note layers). Everything here is
   * VISUAL-ONLY and deliberately announced to nobody: the edges carry no
   * text (DESIGN.md §3 "no text is visible on them") and the "+N more"
   * scrap is decorative chrome — every element is aria-hidden and
   * pointer-events: none, so assistive tech never receives it. The
   * deep-pile count reaches everyone through the durable paths instead —
   * the .title chrome ("40 notes") and the "See all N" link — and T33 owns
   * the full a11y/announcement pass.
   *
   * Props arrive pre-capped and deepest-first via lib/edge-style's
   * peekingEdges() (deepest notes FIRST — they paint behind shallower
   * ones); every visual value is deterministic from the note id/position
   * (the same seam pattern as NoteCard's lib/note-style), so identical
   * note ids render identical edges on every reload/device (the T26
   * done-when's "stable across reload"). All styles come from tokens.css
   * via var() — the guard test enforces it.
   */
  import type { Note } from "@task-stack/shared";
  import { edgeShadowToken, edgeTilt, edgeX, edgeY } from "../lib/edge-style";
  import { noteColorVar } from "../lib/note-style";

  interface Props {
    /** Pre-capped, deepest-first peeking notes (lib/edge-style). */
    notes: Note[];
    /** Notes hidden beyond the visible cap — 0 renders no scrap. */
    hidden: number;
  }

  let { notes, hidden }: Props = $props();
</script>

{#each notes as note (note.id)}
  <div
    class="edge"
    aria-hidden="true"
    style:--edge-color={noteColorVar(note.id)}
    style:--edge-x={edgeX(note.id) + "px"}
    style:--edge-y={edgeY(note.id) + "px"}
    style:--edge-tilt={edgeTilt(note.id) + "deg"}
    style:--edge-shadow={edgeShadowToken(note.position)}
  ></div>
{/each}

{#if hidden > 0}
  <div class="scrap" aria-hidden="true">+{hidden} more</div>
{/if}

<style>
  /* One buried note's paper edge. Comment-paired with NoteCard.svelte's
    .card and StackView's .deck — one pile silhouette, three consumers:
    the deck defines --pile-w/--pile-h once, this edge inherits them (the
    fallbacks keep the component standalone-correct — standalone rendering
    via its literals if the deck's vars are absent). Material family is
    shared with the card (token color, hairline, glue strip, graded
    shadow); T28's responsive pass will tokenize all three silhouettes. */
  .edge {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--pile-w, min(320px, 90vw));
    min-height: var(--pile-h, 320px);
    border-radius: var(--radius-note);
    background: var(--edge-color);
    /* DESIGN.md §2's slightly-darker paper edge, same hairline as the top
       card — buried paper keeps the material, not the ink. */
    border: 1px solid var(--outline-soft);
    /* Depth-graded shadow token (lib/edge-style: position 2–5 near, 6–10
       buried middle, 11+ far — rungs chosen from server-truth position). */
    box-shadow: var(--edge-shadow);
    /* translate BEFORE rotate: the ±6–10px offsets are the brief's exact
       desk-space distances (DESIGN.md §2) — rotate-then-translate would
       swing the offset by the tilt and stretch distances past 10px.
       Deliberately NO grain overlay (the mockup's buried notes have none;
       it also keeps up-to-14 edges filter-free) and no text ever (§3). */
    transform: translate(var(--edge-x), var(--edge-y)) rotate(var(--edge-tilt));
    pointer-events: none;
  }

  /* Glue sheen along the top edge — same adhesive band as the top card,
     duplicated as a pseudo-element (a decorative child div would still
     work, but ::before keeps the paint order inside the edge itself). */
  .edge::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    border-radius: var(--radius-note) var(--radius-note) 0 0;
    background: var(--note-glue);
  }

  /* The "+N more" paper chit (DESIGN.md §5.1 deep state) — a passive
     scrap, NOT a button: the desk's "See all N" link is the affordance.
     Initial values, tunable in visual review. */
  .scrap {
    position: absolute;
    right: -12px;
    bottom: -14px;
    padding: 4px 10px;
    border-radius: var(--radius-note);
    background: var(--paper-warm);
    border: 1px solid var(--outline-soft);
    box-shadow: var(--shadow-note-edge-far);
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: var(--text-label-md);
    transform: rotate(-3deg);
    pointer-events: none;
  }
</style>
