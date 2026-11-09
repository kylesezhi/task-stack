<script lang="ts">
  /**
   * The paper note card (T25; DESIGN.md §2 "note material", §5.1 top card;
   * mockup: stack_view_home) — the one card the desk centers on. T26 stacks
   * buried edges beneath it; the push spring lives here too (T27 — DESIGN.md
   * §7: the new note "drops in and slaps on with a springy bounce, tilting
   * into place"); T29's reveal settle lives here as well — when a pop
   * ceremony reveals this card beneath the burning ghost, it springs up and
   * settles with a tiny bounce (DESIGN.md §5.2 step 5; the burning ghost
   * itself is PopCeremony's). T30 animates the card away on a toss.
   *
   * Every visual value is deterministic from the note id (lib/note-style):
   * same note → same tilt and color on every device, forever (DECISIONS.md
   * §3; the T25 done-when "reload → identical placement for the same note
   * ids"). Colors come only from tokens.css — the guard test enforces it;
   * the glue gradient and feTurbulence grain are composite material tokens,
   * verbatim-mockup data like the shadows.
   *
   * The landing animation (with StackView, T27) animates ONLY
   * transform/opacity — its keyframes may reference --card-tilt and the
   * motion tokens (tokens.css owns durations/easings so T29/T30 don't
   * re-litigate them) — and its 100% keyframe equals the card's natural
   * rest state exactly, so the settled pile is byte-identical whether or
   * not a push animated (the T25/T26 reload-stability contract). Reduced
   * motion becomes a plain opacity fade (DESIGN.md §7: "every animation
   * becomes a simple fade") — the first prefers-reduced-motion handling in
   * the codebase; T29/T30/T32 repeat the pattern.
   *
   * The card stays presentation-only apart from the landing props: the
   * desk's action row owns every interaction (DESIGN.md §5.1), so this
   * element is plain reading surface — selectable text, no click
   * affordances of its own. StackView keys this element per top-note id
   * and passes `landing` from its tracker; `onLanded` clears that flag on
   * the card's animationend. Since T28 StackView ALSO passes `concealed`
   * while the note is being edited: the card stays mounted IN FLOW
   * (visibility: hidden — see .card.concealed) so the pile's box never
   * changes when the edit form overlays it (the T26 edit-shift residual,
   * closed here rather than by an unmount).
   */
  import type { Note } from "@task-stack/shared";
  import { noteColorVar, noteTilt } from "../lib/note-style";

  interface Props {
    note: Note;
    /** True while this note's push landing animation is live (StackView's
     * observation tracker decides; the card only wears it). */
    landing?: boolean;
    /** True while this note is being edited inline (StackView). The card
     * stays in flow with visibility:hidden — its box keeps holding the
     * pile up beneath the overlaying edit form — and drops out of the
     * accessibility tree and text selection entirely (unlike opacity or
     * color, visibility:hidden is announced to nobody). */
    concealed?: boolean;
    /** True while this card is the one a pop ceremony just revealed
     * (StackView's pop tracker decides; the card only wears it). The
     * settle bounce is delayed against --motion-pop so it lands as the
     * ghost's last embers drift off. `landing` and `revealed` can never
     * coincide: a landing id is brand-new to the pile, a revealed id was
     * buried in it one observation ago (the two trackers' rules are
     * disjoint by construction). */
    revealed?: boolean;
    /** camelCase handler (house naming), called on the landing
     * animation's end so StackView can clear its landing flag. Defaults
     * to a no-op — the card renders fine wherever nobody cares. */
    onLanded?: () => void;
    /** Same for the reveal settle (T29): clears StackView's reveal flag. */
    onRevealed?: () => void;
  }

  let {
    note,
    landing = false,
    concealed = false,
    revealed = false,
    onLanded = () => {},
    onRevealed = () => {},
  }: Props = $props();

  const tiltDegrees = $derived(noteTilt(note.id));
  const background = $derived(noteColorVar(note.id));

  /** Guards on the flags: landing and revealed are mutually exclusive (see
   * the prop docs), so each animation's end clears only its own flag. */
  function onAnimationEnd(): void {
    if (landing) onLanded();
    if (revealed) onRevealed();
  }
</script>

<article
  class="card"
  class:landing
  class:concealed
  class:revealed
  style:--card-tilt={tiltDegrees + "deg"}
  style:--card-color={background}
  onanimationend={onAnimationEnd}
>
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
    /* The pile silhouette (T28): width/height come from tokens.css'
       --pile-w/--pile-h — the ONE source the deck box, this card, and the
       buried edges all read, so no layer can ever disagree about the
       pile's size at any viewport. (Until T28 this was the duplicated
       min(320px, 90vw) literal.) min-height (not aspect-ratio) so a long
       note grows the card instead of clipping — readability beats the
       square (DESIGN.md §5.1: exactly one READABLE task); --pile-h stays
       flat 320px at every width per the tokens.css derivation. */
    width: var(--pile-w);
    min-height: var(--pile-h);
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

  /* Edit mode (T28): the card is NOT unmounted — it goes visibility:
     hidden, which keeps its full box in flow (the deck's height stays
     max(cardHeight, pile floor) at all times, so NOTHING shifts when the
     edit form opens or closes — the T26 edit-shift residual, closed) and,
     unlike display:none or opacity, removes the element from the
     accessibility tree and from text selection entirely: the overlaying
     edit form is the only surface that exists for AT and selection. */
  .card.concealed {
    visibility: hidden;
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

  /* -- Push landing (T27; sources: TASKS.md T27, DESIGN.md §7 "drops in
        and slaps on with a springy bounce, tilting into place",
        DECISIONS.md §3): animates ONLY transform/opacity, and the 100%
        keyframe is the card's natural rest state EXACTLY — the settled
        pile stays byte-identical to the un-animated one (the T25/T26
        reload-stability contract; DECISIONS.md §3). fill-mode: both keeps
        the 0% keyframe authoritative from the very first painted frame
        (no flash of the rest state before the fall). */
  .card.landing {
    animation: push-land var(--motion-push) both;
  }

  /* Choreography lives HERE, deliberately not in tokens.css (tokens own
     durations/easings so T29/T30 don't re-litigate them; these numbers are
     hand-tuned feel, verified against the T27 done-when's visual review).
     0% starts 340px above the pile, rotated steeper than rest, invisible —
     then falls with --ease-drop (accelerating like gravity). ~8% the sheet
     has materialized mid-fall (opacity needs the head start; a card that
     appears AT impact reads as a flicker, a card visible the whole fall
     reads as slow/floaty). ~55% impact: a brief squash (scale wider than
     tall, as if slapped down) a few px past rest. From impact onward the
     segments run --ease-spring: the dip-to-rebound rhythm of a photo-paper
     bounce paper settles from. 100% is the rest state — EXPLICIT
     translateY(0)/scale(1) plus rotate(--card-tilt), in the SAME function
     order as every keyframe before it (one shared list means every
     segment interpolates per-function; a mismatched list would force
     matrix decomposition on the 86%→100% segment). The final matrix is
     mathematically identical to the natural rest rule above, so the
     animation's last frame IS the deterministic still (no transform
     drift, ever; the settled pile is byte-identical to the un-animated
     one). */
  @keyframes push-land {
    0% {
      transform: translateY(-340px) rotate(calc(var(--card-tilt) * 2.5)) scale(1);
      opacity: 0;
      animation-timing-function: var(--ease-drop);
    }
    8% {
      opacity: 1;
    }
    55% {
      transform: translateY(5px) rotate(calc(var(--card-tilt) * 1.1)) scale(1.05, 0.95);
      animation-timing-function: var(--ease-spring);
    }
    72% {
      transform: translateY(-7px) rotate(calc(var(--card-tilt) * 0.95)) scale(0.99, 1.01);
      animation-timing-function: var(--ease-spring);
    }
    86% {
      transform: translateY(2px) rotate(var(--card-tilt)) scale(1.01, 0.99);
      animation-timing-function: var(--ease-spring);
    }
    100% {
      transform: translateY(0) rotate(var(--card-tilt)) scale(1);
      opacity: 1;
    }
  }

  /* -- Reveal settle (T29; DESIGN.md §5.2 step 5: "The note beneath is
        revealed and settles with a tiny bounce"; mockup: the under-note's
        3.2px spring oscillation, juiced slightly). Runs on the NEW top card
        while the ghost (PopCeremony) burns above it. The delay pins the
        bounce to the ghost's burn-out (~74% of the shared --motion-pop
        clock); fill-mode: both makes the 0% frame authoritative during the
        delay, so the card sits ever-so-slightly compressed — bearing the
        departed note's weight — then springs past rest and settles. Same
        contract as push-land: transform/opacity only, one fixed function
        order (translateY → rotate → scale), and the 100% keyframe equals
        the natural rest rule EXACTLY, so the settled pile is byte-identical
        whether or not a ceremony animated (DECISIONS.md §3). */
  .card.revealed {
    animation: pop-reveal var(--motion-reveal) var(--ease-spring) calc(var(--motion-pop) * 0.74)
      both;
  }

  @keyframes pop-reveal {
    0% {
      transform: translateY(2px) rotate(var(--card-tilt)) scale(0.985);
    }
    45% {
      transform: translateY(-5px) rotate(var(--card-tilt)) scale(1.015);
    }
    72% {
      transform: translateY(1.5px) rotate(var(--card-tilt)) scale(0.996);
    }
    100% {
      transform: translateY(0) rotate(var(--card-tilt)) scale(1);
    }
  }

  /* Reduced motion (DESIGN.md §7: "every animation becomes a simple fade")
     — the codebase's FIRST prefers-reduced-motion block; this is the
     pattern T29/T30/T32 repeat: swap the named animation for a plain
     opacity-only fade at --motion-fade, no transform, so the element
     renders at rest instantly and fades in. Same 100%-equals-rest
     property: the fade's end state is exactly the natural card. The
     revealed card cross-fades with the ghost's own fade (PopCeremony's
     pop-ceremony-fade) — together they ARE the reduced-motion ceremony. */
  @media (prefers-reduced-motion: reduce) {
    .card.landing {
      animation: push-fade var(--motion-fade) both;
    }
    .card.revealed {
      animation: push-fade var(--motion-fade) both;
    }
    @keyframes push-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  }
</style>
