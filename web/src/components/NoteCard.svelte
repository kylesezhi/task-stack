<script lang="ts">
  /**
   * The paper note card (T25; DESIGN.md §2 "note material", §5.1 top card;
   * mockup: stack_view_home) — the one card the desk centers on. T26 stacks
   * buried edges beneath it; T27 springs the push landing onto it; T29/T30
   * animate it away (ceremony, toss). Material first, motion later: this
   * task ships the card's still-life look.
   *
   * Every visual value is deterministic from the note id (lib/note-style):
   * same note → same tilt and color on every device, forever (DECISIONS.md
   * §3; the T25 done-when "reload → identical placement for the same note
   * ids"). Colors come only from tokens.css — the guard test enforces it;
   * the glue gradient and feTurbulence grain are composite material tokens,
   * verbatim-mockup data like the shadows.
   *
   * The card is presentation only: the desk's action row owns every
   * interaction (DESIGN.md §5.1), so this element is plain reading surface —
   * selectable text, no click affordances of its own.
   */
  import type { Note } from "@task-stack/shared";
  import { noteColorVar, noteTilt } from "../lib/note-style";

  interface Props {
    note: Note;
  }

  let { note }: Props = $props();

  const tiltDegrees = $derived(noteTilt(note.id));
  const background = $derived(noteColorVar(note.id));
</script>

<article class="card" style:--card-tilt={tiltDegrees + "deg"} style:--card-color={background}>
  <!-- Material overlays sit above the paper, below the ink: the post-it's
       adhesive sheen band, then the grain tooth. pointer-events:none keeps
       the text selectable (mockup: select-text). -->
  <div class="glue" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>
  <!-- .note-text is a durable e2e locator (stack-view / sync specs) — the
       class lives where the TEXT lives and moves with it. -->
  <p class="note-text">{note.text}</p>
</article>

<style>
  .card {
    position: relative;
    /* Mockup sm card is 320×320; T28 owns the real responsive scale, so this
       is the desktop silhouette only. min-height (not aspect-ratio) so a
       long note grows the card instead of clipping — readability beats the
       square (DESIGN.md §5.1: exactly one READABLE task). */
    width: min(320px, 90vw);
    min-height: 320px;
    border-radius: var(--radius-note);
    background: var(--card-color);
    /* "Slightly darker 1px paper edge" (DESIGN.md §2): the soft warm hairline
       token reads as a darker paper edge over every palette color. */
    border: 1px solid var(--outline-soft);
    /* The top-note lift: the layered composite from the mockup, verbatim. */
    box-shadow: var(--shadow-note-top);
    /* The hand-placed lean (deterministic per id, ±2–6°). */
    transform: rotate(var(--card-tilt));
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    justify-content: center;
    user-select: text;
  }

  /* Post-it adhesive sheen along the top edge (mockup "glue adhesive sheen
     strip"): a 24px translucent band fading downward into the paper. */
  .glue {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    border-radius: var(--radius-note) var(--radius-note) 0 0;
    background: var(--note-glue);
    pointer-events: none;
  }

  /* Subtle paper grain (DESIGN.md §2; DECISIONS.md §8 "SVG turbulence"): the
     feTurbulence tile token, inset to the card's rounded corners. */
  .grain {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image: var(--note-grain);
    pointer-events: none;
  }

  .note-text {
    /* Above the material overlays. */
    position: relative;
    margin: 0;
    color: var(--ink);
    font-family: var(--font-hand);
    /* DESIGN.md §2: "readable from across a desk" — the 29px token. */
    font-size: var(--text-note);
    /* Caveat's variable file backs 400–700 (tokens.css); the mockup weighs
       the handwriting at 600. */
    font-weight: 600;
    /* Mockup leading/tracking on the handwriting. */
    line-height: 1.35;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
</style>
