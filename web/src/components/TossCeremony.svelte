<script lang="ts">
  /**
   * The toss ceremony (T30; sources: TASKS.md T30, DESIGN.md §7 "Toss: a
   * quick crumple and the note drops out of frame. No fire for tossed
   * notes.", DECISIONS.md §4 "Toss — delete a note quietly (no ceremony,
   * no archive credit)" / §7 "Toss gets a brief quiet crumple"). StackView
   * mounts this over the deck the moment a snapshot says the top note left
   * WITHOUT landing in completed[] (lib/departure's tracker decides); the
   * REAL pile beneath has already updated, so the survivor sits revealed
   * under the ghost for the whole sequence — and, deliberately, it does
   * NOT settle with a bounce: the toss is quiet, no reveal dance
   * (StackView never sets revealId for a toss).
   *
   * The four phases run as ONE shared clock — --motion-toss (tokens.css;
   * the T29/T30 split keeps durations/easings shared, choreography local):
   *   1. REST-LIFT (0–13%)   a tiny anticipatory lift off the pile — the
   *                          adhesive lets go, nothing like the pop's
   *                          operatic hover;
   *   2. CRUMPLE (15–40%)    corners fold in fast — SVG feTurbulence +
   *                          feDisplacementMap wrinkles the silhouette
   *                          (soft, then deep) while the paper balls up
   *                          and the ink dies (~30%, long gone before
   *                          the departure is readable);
   *   3. BALL (40–46%)       an asymmetric squash — paper never balls
   *                          evenly — then it simply lets go;
   *   4. DROP (46–100%)      the ball falls out of frame — a bounded
   *                          translateY(min(240px, 30vh)), a small tumble,
   *                          and a fade at the very end.
   *
   * NO FIRE, ever (the whole difference from PopCeremony): no mask, no
   * burn front, no embers, no --ember-* token anywhere, no burning color —
   * the paper stays paper (a subtle color-mix toward --ink shades the ball
   * as it crumples; tokens-only, guard-test-clean). CSS/SVG only, no
   * libraries (TASKS.md T30). Everything visual flows from the note id
   * (tilt/color via lib/note-style) or from tokens.css — deterministic
   * per note (DECISIONS.md §3). Reduced motion (DESIGN.md §7): a simple
   * opacity fade — no filter, no transform motion, no dance at all.
   *
   * This element is a decorative MIRROR of a note that is already deleted
   * server-side: aria-hidden, pointer-events none, unselectable, and its
   * text deliberately does NOT carry the e2e-durable .note-text class
   * (it is .toss-ghost-text — the surviving card beneath is the one true
   * .note-text; locators must never see double while the two coexist).
   */
  import type { Note } from "@task-stack/shared";
  import { noteColorVar, noteTilt } from "../lib/note-style";

  interface Props {
    /** The tossed note, as it last sat on the desk (the tracker's own
     * previous observation — by ceremony time it is gone from the pile
     * AND from the server). */
    note: Note;
    /** Called when the ghost's master timeline ends so StackView can drop
     * the ghost (and re-arm the action row). camelCase per house naming. */
    onDropped?: () => void;
  }

  let { note, onDropped = () => {} }: Props = $props();

  const tiltDegrees = $derived(noteTilt(note.id));
  const background = $derived(noteColorVar(note.id));

  /** The toss ends when the GHOST's own master timeline says so. Child
   * timelines (paper, ink) bubble their animationend too — target ===
   * currentTarget singles out the ghost, and the name check singles out
   * toss-ceremony among them (neither child's name contains it). The
   * reduced-motion fade is named toss-ceremony-fade precisely so this one
   * check covers both. PopCeremony's sibling check is identical in shape. */
  function onAnimationEnd(event: AnimationEvent): void {
    if (event.target === event.currentTarget && event.animationName.includes("toss-ceremony")) {
      onDropped();
    }
  }
</script>

<div class="toss-scene" aria-hidden="true">
  <!-- The crumple wrinkles: feTurbulence warp + feDisplacementMap, two
       intensities the ghost's master timeline switches between at pinned
       keyframes (PopCeremony's filter pair, quieter scales — the toss
       wrinkle is a squeeze, not a violence). Distinct ids from the pop
       filters so the two ceremonies never collide if they ever coexist.
       Filters carry no color — the token guard never scans them. -->
  <svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <filter id="toss-crumple-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.04 0.05"
          numOctaves="2"
          seed="23"
          result="warp"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="warp"
          scale="9"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter id="toss-crumple-deep" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.055 0.07"
          numOctaves="3"
          seed="17"
          result="warp"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="warp"
          scale="15"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>

  <!-- The ghost: geometry + choreography only. The paper VISUALS live on
       .toss-box (same split as PopCeremony's .burn-box — there the mask
       forced it; here it keeps the master timeline on one layer and the
       material's own metamorphosis on the paper, exactly like the pop's
       pop-paper). Runs on the shared --motion-toss clock. -->
  <div
    class="toss-ghost"
    style:--card-tilt={tiltDegrees + "deg"}
    style:--card-color={background}
    onanimationend={onAnimationEnd}
  >
    <div class="toss-box">
      <div class="glue"></div>
      <div class="grain"></div>
      <p class="toss-ghost-text">{note.text}</p>
    </div>
  </div>
</div>

<style>
  /* The overlay: same box and same centering as the pile beneath it
     (.deck.pile is flex-column centered — the ghost lands exactly on the
     departed card's spot) and the same architectural shape as
     PopCeremony's .ceremony: absolute inset:0 of the position:relative
     .deck, pointer-events none, unselectable. StackView renders this
     component BEFORE PopCeremony in the deck's DOM so, if the two ghosts
     ever coexist (a pop landing while a toss ghost is mid-drop), the pop
     paints above — one desk ghost at a time is the rule either way. */
  .toss-scene {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    user-select: none;
  }

  .defs {
    position: absolute;
  }

  /* The ghost — the departed note's actor. Mirrors NoteCard's .card
     silhouette from the same --pile-w/--pile-h tokens (the one-source
     pile contract) but carries NO paper paint of its own: everything
     visual is on .toss-box. One master timeline (transform/opacity/
     filter) on the shared --motion-toss clock; the paper and the ink run
     their own child timelines on the SAME clock so the phases can never
     drift. will-change promotes one layer for the 620ms ride; the
     element is gone after. */
  .toss-ghost {
    position: relative;
    width: var(--pile-w);
    transform: rotate(var(--card-tilt));
    animation: toss-ceremony var(--motion-toss) both;
    will-change: transform, opacity, filter;
  }

  /* The paper. Identical box rules to NoteCard's .card (token color,
     hairline, the top-note lift shadow, the same padding/flex centering
     and min-height growth) so frame 0 is indistinguishable from the card
     it replaces — the master timeline's 0% IS the card's natural rest
     state — and the ghost materializes seamlessly between the departed
     card's disappearance and its mirror.

     GEOMETRY CLAMP (same as PopCeremony's .burn-box, and for the same
     reason): a ceremony ghost must NEVER grow the page's scrollable
     overflow — transformed boxes count toward it even mid-animation — so
     the ghost is capped to the pile silhouette (min/max-height +
     overflow:hidden; the tall note's text clips symmetrically for the
     few hundred ms it shows). The choreography itself stays inside the
     T29-derived 390px budget: the HORIZONTAL reach is rotation × size
     only — the tilt is ±[2,6)°, the animation's every keyframe keeps the
     total rotation ≤ 9° absolute (every keyframe's rotation is calc(
     var(--card-tilt) − at most 3°), so rest lands at ±6° worst-case and
     the deepest tumble lean lands at |tilt − 3°| ≤ 9°), there is NO
     horizontal translation, and scale peaks at 1.02 during the lift (worst case: 1.02·(310·cos7° + 320·sin7°) ≈ 354px at the
     390px viewport — inside, with slack). The drop is VERTICAL only —
     translateY(min(240px, 30vh)) — bounded, so it can never open an
     unbounded document growth (vertical scroll, if the desk is short, is
     ordinary page scrolling, not horizontal). */
  .toss-box {
    position: relative;
    min-height: var(--pile-h);
    max-height: var(--pile-h);
    overflow: hidden;
    border-radius: var(--radius-note);
    background: var(--card-color);
    border: 1px solid var(--outline-soft);
    box-shadow: var(--shadow-note-top);
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    justify-content: center;
    animation: toss-paper var(--motion-toss) both;
  }

  /* Glue sheen + grain: the same material layers as the card (mockup
     post-it), crumpling away with the paper they sit on (no separate
     animation — the paper's own timeline is the only one they follow). */
  .glue {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    border-radius: var(--radius-note) var(--radius-note) 0 0;
    background: var(--note-glue);
  }

  .grain {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image: var(--note-grain);
  }

  /* .toss-ghost-text, NEVER .note-text (the header's locator contract):
     visually the twin of NoteCard's .note-text (same token type ramp),
     but its class is this component's own, so the e2e suite's durable
     .note-text locator sees exactly ONE note while the ghost lives. */
  .toss-ghost-text {
    position: relative;
    margin: 0;
    color: var(--ink);
    font-family: var(--font-hand);
    font-size: var(--text-note);
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    animation: toss-ink var(--motion-toss) both;
  }

  /* -- The master timeline. Per-property keyframe lists, exactly like
     pop-ceremony: a property interpolates between the keyframes that
     mention it, so the filter switches are pinned by tight adjacent
     pairs (discrete interpolation jumps at a segment's midpoint — the
     14.9%/15% and 33.9%/34% pairs put that midpoint exactly at the
     crumple's start and deepening). Transform function order is
     identical in every keyframe (translateY → rotate → scale) so each
     segment interpolates per-function. 0% IS the card's natural rest
     state — same plain-rotate matrix the un-mirrored card computes to.
     (100% need NOT equal rest: the element unmounts on its end.) */
  @keyframes toss-ceremony {
    0% {
      transform: translateY(0) rotate(var(--card-tilt)) scale(1);
      opacity: 1;
      filter: none;
      animation-timing-function: var(--ease-lift);
    }
    /* REST-LIFT — the adhesive lets go; a breath, not the pop's hover. */
    8% {
      transform: translateY(-5px) rotate(calc(var(--card-tilt) - 1deg)) scale(1.02);
    }
    13% {
      transform: translateY(-3px) rotate(calc(var(--card-tilt) - 0.5deg)) scale(1.01);
      animation-timing-function: var(--ease-drop);
    }
    14.9% {
      filter: none;
    }
    /* CRUMPLE — the wrinkle filter bites almost immediately. */
    15% {
      filter: url("#toss-crumple-soft");
    }
    22% {
      transform: translateY(-2px) rotate(calc(var(--card-tilt) - 1.5deg)) scale(0.85, 0.78);
    }
    33.9% {
      filter: url("#toss-crumple-soft");
    }
    /* …deepens as the corners really fold in. */
    34% {
      filter: url("#toss-crumple-deep");
    }
    /* BALL — the asymmetric squash (paper never balls evenly), then a
       breath's hold before it simply lets go. */
    40% {
      transform: translateY(-4px) rotate(calc(var(--card-tilt) - 2deg)) scale(0.66, 0.58);
      opacity: 1;
      animation-timing-function: linear;
    }
    /* DROP — gravity (--ease-drop accelerates the whole fall) from rest
       height down through the bottom of the frame; a small tumble to the
       deepest lean, calc(var(--card-tilt) - 3deg) — bounded ≤ 9° absolute
       with the tilt's ±[2,6) range (see the geometry clamp above) — and
       fading out at the very end. The 30vh
       cap folds the drop under short viewports (720px e2e default: 216px
       < 240px); translateY is vertical-only, so no unbounded document
       growth in either axis (see the clamp note). */
    46% {
      transform: translateY(4px) rotate(calc(var(--card-tilt) - 3deg)) scale(0.62);
      animation-timing-function: var(--ease-drop);
    }
    74% {
      opacity: 1;
    }
    100% {
      transform: translateY(min(240px, 30vh)) rotate(calc(var(--card-tilt) - 3deg)) scale(0.5);
      opacity: 0;
    }
  }

  /* The paper's own metamorphosis: the crumple keeps the paper PAPER — no
     burning hues anywhere (the whole point of T30; --ember-* is banned
     from this file and the token guard stays the law) — only a subtle
     shade toward --ink as the wad forms (crumpled paper reads darker
     across its folds; color-mix keeps every intermediate token-derived),
     and the corners round into the ball. Phase keys pair with the master
     timeline (same clock, no drift). */
  @keyframes toss-paper {
    0%,
    15% {
      background: var(--card-color);
      border-radius: var(--radius-note);
    }
    40% {
      background: color-mix(in srgb, var(--card-color) 85%, var(--ink));
      border-radius: 22px;
    }
    100% {
      background: color-mix(in srgb, var(--card-color) 70%, var(--ink));
      border-radius: 40px;
    }
  }

  /* The ink dies by ~30% — the ball is unreadable well before the drop,
     so the departure never frees a legible task mid-fall (tossed notes
     get no last look; §4: no archive credit, no ceremony). */
  @keyframes toss-ink {
    0%,
    10% {
      opacity: 1;
    }
    30%,
    100% {
      opacity: 0;
    }
  }

  /* Reduced motion (DESIGN.md §7 "every animation becomes a simple fade";
     TASKS.md T30's throwaway is no exception): the ghost simply fades
     out — no transform motion, no filter passes, no paper/ink dances.
     The fade is named toss-ceremony-fade so the ghost's animationend
     contract (see onAnimationEnd) covers it in one check, the same
     pattern as PopCeremony's pop-ceremony-fade. */
  @media (prefers-reduced-motion: reduce) {
    .toss-ghost {
      animation: toss-ceremony-fade var(--motion-fade) both;
      will-change: auto;
    }
    @keyframes toss-ceremony-fade {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
    .toss-box {
      animation: none;
    }
    .toss-ghost-text {
      animation: none;
    }
    /* The filter defs serve nothing under reduced motion. */
    .defs {
      display: none;
    }
  }
</style>
