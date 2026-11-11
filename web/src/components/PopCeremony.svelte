<script lang="ts">
  /**
   * The pop ceremony (T29; sources: TASKS.md T29, DESIGN.md §5.2/§7,
   * DECISIONS.md §7 "crumple via feTurbulence/displacement, burn via mask",
   * mockup: pop_ceremony_sequence) — the app's signature moment. StackView
   * mounts this over the deck the moment a snapshot says the top note was
   * completed (local or remote — lib/departure's tracker decides); the
   * REAL pile beneath has already updated, so the new top card sits revealed
   * under the ghost for the whole sequence and settles with its own tiny
   * bounce (NoteCard's `revealed`) as the last embers drift off.
   *
   * The five phases (DESIGN.md §5.2) run as ONE shared clock —
   * --motion-pop — so they can never drift apart:
   *   1. LIFT    (0–24%)  the note peels off, hovers a breath, inhales;
   *   2. CRUMPLE (24–38%) corners fold in — SVG feTurbulence + feDisplacementMap
   *                       wrinkles the silhouette (soft, then deep) while the
   *                       paper balls up and the ink dies;
   *   3. BURN    (37–78%) fire catches the bottom corner: an animated
   *                       radial mask eats the paper (--burn-r, registered in
   *                       app.css so it interpolates) and a hot ember rim
   *                       rides the exact same radius — the burn front;
   *   4. DRIFT   (76–100%) the ember core rises, thins, and goes out while
   *                       loose sparks drift up after it;
   *   5. REVEAL  (74%→)   owned by NoteCard's pop-reveal — the note beneath
   *                       springs up ~5px and settles.
   *
   * CSS/SVG only, no libraries (TASKS.md T29). Everything visual flows from
   * the note id (color/tilt via lib/note-style, burn side from the tilt's
   * lean) or from tokens.css — deterministic per note (DECISIONS.md §3);
   * the ember scatter is hand-tuned choreography, identical for every pop.
   * Reduced motion (DESIGN.md §7): the whole ceremony becomes a simple fade
   * — no mask, no filter, no embers, no transform.
   *
   * This element is a decorative MIRROR of a note that is already archived
   * server-side: aria-hidden, pointer-events none, unselectable, and its
   * text deliberately does NOT carry the e2e-durable .note-text class (the
   * revealed card beneath is the one true .note-text — locators must never
   * see double during the 1.6s the two coexist).
   */
  import type { Note } from "@task-stack/shared";
  import { noteColorVar, noteTilt } from "../lib/note-style";

  interface Props {
    /** The completed note, as it last sat on the desk (the tracker's own
     * previous observation — by ceremony time it is gone from the pile). */
    note: Note;
    /** Called when the ghost's master timeline ends so StackView can drop
     * the ghost (and re-arm the action row). camelCase per house naming. */
    onExtinguished?: () => void;
  }

  let { note, onExtinguished = () => {} }: Props = $props();

  const tiltDegrees = $derived(noteTilt(note.id));
  const background = $derived(noteColorVar(note.id));
  /** Fire catches the bottom corner on the side the note leans toward — the
   * lean is the note's handedness, deterministic per id forever. */
  const burnX = $derived(tiltDegrees >= 0 ? "80%" : "20%");

  /** Ember scatter — hand-tuned choreography constants (feel, not data;
   * tokens.css' motion split keeps the clock shared and the dance local).
   * x/y: spawn offset from the ignition corner (px); dx/rise: travel (px,
   * rise negative = up); at/span: start and length as fractions of
   * --motion-pop so the sparks are born as the burn front passes and the
   * last one dies exactly when the clock does. Colors cycle the three T29
   * ember tokens, hot and mid dominant (celebration, not alarm). */
  const EMBERS: ReadonlyArray<{
    x: number;
    y: number;
    dx: number;
    rise: number;
    size: number;
    at: number;
    span: number;
    color: string;
  }> = [
    { x: -18, y: -4, dx: -34, rise: -160, size: 6, at: 0.4, span: 0.34, color: "var(--ember-hot)" },
    { x: 6, y: 2, dx: 24, rise: -180, size: 5, at: 0.43, span: 0.32, color: "var(--ember)" },
    {
      x: -4,
      y: -10,
      dx: -14,
      rise: -130,
      size: 4,
      at: 0.46,
      span: 0.28,
      color: "var(--ember-deep)",
    },
    { x: 14, y: -2, dx: 38, rise: -150, size: 6, at: 0.5, span: 0.3, color: "var(--ember-hot)" },
    { x: -10, y: 4, dx: -26, rise: -110, size: 4, at: 0.53, span: 0.26, color: "var(--ember)" },
    { x: 2, y: -6, dx: 12, rise: -170, size: 5, at: 0.56, span: 0.3, color: "var(--ember-hot)" },
    { x: -16, y: 0, dx: -40, rise: -140, size: 4, at: 0.6, span: 0.27, color: "var(--ember)" },
    { x: 10, y: -8, dx: 30, rise: -120, size: 4, at: 0.64, span: 0.25, color: "var(--ember-deep)" },
    { x: 0, y: -2, dx: -10, rise: -155, size: 5, at: 0.68, span: 0.24, color: "var(--ember)" },
    { x: 8, y: 0, dx: 20, rise: -135, size: 4, at: 0.72, span: 0.23, color: "var(--ember-hot)" },
    { x: -8, y: -6, dx: -22, rise: -115, size: 4, at: 0.75, span: 0.22, color: "var(--ember)" },
    { x: 4, y: -4, dx: 8, rise: -145, size: 5, at: 0.78, span: 0.22, color: "var(--ember-deep)" },
  ];

  /** The ceremony ends when the GHOST's own master timeline says so.
   * Child timelines (burn rim, ink, embers) bubble their animationend too —
   * target === currentTarget singles out the ghost, and the name check
   * singles out pop-ceremony among its two (the --burn-r driver ends on the
   * same tick but is not the contract). The reduced-motion fade is named
   * pop-ceremony-fade precisely so this one check covers both. */
  function onAnimationEnd(event: AnimationEvent): void {
    if (event.target === event.currentTarget && event.animationName.includes("pop-ceremony")) {
      onExtinguished();
    }
  }
</script>

<div class="ceremony" aria-hidden="true" style:--burn-x={burnX}>
  <!-- The crumple wrinkles: feTurbulence warp + feDisplacementMap, two
       intensities the ghost's master timeline switches between at pinned
       keyframes (DECISIONS.md §7). Filters carry no color — the token guard
       never scans them, and there is nothing to token anyway. -->
  <svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <filter id="pop-crumple-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.035 0.05"
          numOctaves="2"
          seed="11"
          result="warp"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="warp"
          scale="11"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter id="pop-crumple-deep" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.05 0.065"
          numOctaves="3"
          seed="4"
          result="warp"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="warp"
          scale="17"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>

  <!-- The ghost: geometry + choreography only. The paper VISUALS live on
       .burn-box because the burn mask must eat background, border, shadow,
       glue, grain, and ink together — a mask only covers its own element. -->
  <div
    class="pop-ghost"
    style:--card-tilt={tiltDegrees + "deg"}
    style:--card-color={background}
    onanimationend={onAnimationEnd}
  >
    <div class="burn-box">
      <div class="glue"></div>
      <div class="grain"></div>
      <p class="pop-ghost-text">{note.text}</p>
    </div>
    <!-- The burn front: a hot rim + char band + glow falloff riding the SAME
         --burn-r the mask consumes with, so the fire line sits exactly on
         the paper's burning edge. Lives outside the mask (the mask would eat
         the rim's outer half) and inside the ghost's filter (the fire line
         gets the same ragged wrinkle as the burning silhouette). -->
    <div class="burn-front"></div>
  </div>

  <!-- Loose sparks, anchored to the deck (not the ghost): the fire's site
       stays put while the ember core rises away from it. -->
  <div class="embers">
    {#each EMBERS as ember, i (i)}
      <span
        class="pop-ember"
        style:--ex={ember.x + "px"}
        style:--ey={ember.y + "px"}
        style:--edx={ember.dx + "px"}
        style:--erise={ember.rise + "px"}
        style:--esize={ember.size + "px"}
        style:--eat={ember.at}
        style:--espan={ember.span}
        style:--ecolor={ember.color}
      ></span>
    {/each}
  </div>
</div>

<style>
  /* The overlay: same box and same centering as the pile beneath it
     (.deck.pile is flex-column centered — the ghost lands exactly on the
     departed card's spot). Last positioned child of .deck, so DOM order
     paints it above the card and the buried edges — no z-index. When the
     pop empties the stack, the deck wraps T31's empty-state — the same
     pile footprint — so the inset:0 overlay still centers the ghost
     exactly where the pile was. */
  .ceremony {
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

  /* The ghost — the departed note's actor. Mirrors .card's silhouette from
     the same --pile-w/--pile-h tokens (the one-source pile contract) but
     carries NO paper paint of its own: everything visual is on .burn-box so
     the burn mask consumes it as one piece. Runs TWO timelines on the
     shared --motion-pop clock: the master choreography (transform/opacity/
     filter) and the --burn-r driver both children read. will-change
     promotes one layer for the 1.6s ride; the element is gone after. */
  .pop-ghost {
    position: relative;
    width: var(--pile-w);
    transform: rotate(var(--card-tilt));
    animation:
      pop-ceremony var(--motion-pop) both,
      pop-burn-r var(--motion-pop) both;
    will-change: transform, opacity;
  }

  /* The paper under fire. Identical box rules to NoteCard's .card (token
     color, hairline, the top-note lift shadow, Caveat ink) so frame 0 is
     indistinguishable from the card it replaces — then the mask eats it
     from the ignition corner outward: transparent hole to --burn-r − 2%,
     paper from --burn-r + 4% (var(--ink) is simply the nearest opaque token
     — mask alpha is all that matters here). --burn-r is registered
     (app.css) and animated on the ghost, inherited here.

     GEOMETRY CLAMP (unlike the card, which grows with its text): the ghost
     is capped to the pile silhouette, with the tall note's text clipping
     symmetrically for the few hundred ms it shows. A ceremony ghost must
     NEVER grow the page's scrollable overflow — transformed boxes count
     toward it even mid-animation (the mask/opacity don't exempt them), and
     a 280-char card rotated through the lift (tilt×1.7, scale 1.05) would
     poke ~14px past a 390px viewport; the responsive suite's no-h-scroll
     probes catch exactly that. Worst case with the clamp (390px viewport,
     310×320 ghost): AABB = 1.05·(310·cos10.2° + 320·sin10.2°) ≈ 380px —
     inside, with ~5px of slack per side. The silhouette tokens already
     guarantee the same bound at every narrower width down to ≈310px. */
  .burn-box {
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
    mask-image: radial-gradient(
      farthest-corner at var(--burn-x) 88%,
      transparent calc(var(--burn-r) - 2%),
      var(--ink) calc(var(--burn-r) + 4%)
    );
    animation: pop-paper var(--motion-pop) both;
  }

  /* The fire line. From the hole outward: nothing (the revealed card shows
     through), the white-hot rim, the ember band, the scorched char just
     onto the surviving paper, a warm glow falloff. All stops ride
     calc(var(--burn-r) ± …) — the same radius as the mask, so rim and
     paper edge never separate. Opacity gates it: the ring exists only
     while the burn phase runs (a pre-ignition gradient would otherwise
     paint a stray disc at the ignition corner). */
  .burn-front {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-note);
    /* Two layers: the fire line itself (riding --burn-r), and beneath it a
       broad stationary ambient — the light the fire casts on the nearby
       paper while it burns. The ambient deliberately does NOT ride the
       radius: it is cast light, not the flame front. Both live inside the
       ghost's own box (a background layer paints no new geometry, so the
       ceremony's no-h-scroll budget is untouched). */
    background:
      radial-gradient(
        farthest-corner at var(--burn-x) 88%,
        transparent calc(var(--burn-r) - 3%),
        var(--ember-hot) var(--burn-r),
        var(--ember) calc(var(--burn-r) + 2.5%),
        color-mix(in srgb, var(--ink) 55%, transparent) calc(var(--burn-r) + 5.5%),
        color-mix(in srgb, var(--ember) 45%, transparent) calc(var(--burn-r) + 11%),
        transparent calc(var(--burn-r) + 18%)
      ),
      radial-gradient(
        farthest-corner at var(--burn-x) 88%,
        color-mix(in srgb, var(--ember) 12%, transparent) 0%,
        color-mix(in srgb, var(--ember) 5%, transparent) 38%,
        transparent 62%
      );
    opacity: 0;
    animation: pop-burn-front var(--motion-pop) both;
  }

  /* Glue sheen + grain: the same material layers as the card (mockup
     post-it), burned away with the paper they sit on. */
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

  .pop-ghost-text {
    position: relative;
    margin: 0;
    color: var(--ink);
    font-family: var(--font-hand);
    font-size: var(--text-note);
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    animation: pop-ink var(--motion-pop) both;
  }

  /* One spark. Spawned at the ignition corner (+hand-tuned offset), born
     as the front passes, rising with a slight curve, shrinking out. The
     glow is a radial-gradient body plus a soft token-colored halo — no
     filter blur anywhere (paint budget: nine tiny dots, zero filter
     passes). Delays/durations are fractions of the shared clock via calc
     so --motion-pop retimes the whole scatter at once. */
  .embers {
    position: absolute;
    inset: 0;
  }

  .pop-ember {
    position: absolute;
    left: calc(var(--burn-x) + var(--ex));
    top: calc(84% + var(--ey));
    width: var(--esize);
    height: var(--esize);
    border-radius: 50%;
    background: radial-gradient(
      circle,
      var(--ecolor) 40%,
      color-mix(in srgb, var(--ecolor) 55%, transparent) 65%,
      transparent 78%
    );
    box-shadow: 0 0 10px 2px color-mix(in srgb, var(--ecolor) 60%, transparent);
    opacity: 0;
    animation: pop-ember calc(var(--motion-pop) * var(--espan)) cubic-bezier(0.25, 0.6, 0.35, 1)
      calc(var(--motion-pop) * var(--eat)) both;
  }

  /* -- The master timeline (phases 1–4). Per-property keyframe lists: a
     property interpolates between the keyframes that mention it, so the
     filter switches are pinned by tight adjacent pairs (discrete
     interpolation jumps at a segment's midpoint — the 26.9%/27% pairs put
     that midpoint exactly at the crumple's start and deepening). Transform
     function order is identical in every keyframe (translateY → rotate →
     scale) so each segment interpolates per-function. 0% IS the card's
     natural rest state — the ghost materializes indistinguishable from the
     note it replaces. */
  @keyframes pop-ceremony {
    0% {
      transform: translateY(0) rotate(var(--card-tilt)) scale(1);
      opacity: 1;
      filter: none;
      animation-timing-function: var(--ease-lift);
    }
    /* LIFT — the adhesive lets go; the note levitates and straightens into
       the desk light. */
    12% {
      transform: translateY(-30px) rotate(calc(var(--card-tilt) * 1.7)) scale(1.05);
    }
    /* …hovers a breath (DESIGN.md §5.2 step 1)… */
    18% {
      transform: translateY(-25px) rotate(calc(var(--card-tilt) * 1.5)) scale(1.035);
    }
    /* …inhales once — anticipation before the crunch. */
    24% {
      transform: translateY(-27px) rotate(calc(var(--card-tilt) * 1.62)) scale(1.05);
      animation-timing-function: var(--ease-drop);
    }
    26.9% {
      filter: none;
    }
    /* CRUMPLE — the wrinkle filter bites as the corners fold in. */
    27% {
      filter: url("#pop-crumple-soft");
    }
    33.9% {
      filter: url("#pop-crumple-soft");
    }
    34% {
      filter: url("#pop-crumple-deep");
    }
    /* The ball: asymmetric squash (paper never balls evenly). */
    38% {
      transform: translateY(-15px) rotate(calc(var(--card-tilt) - 10deg)) scale(0.64, 0.58);
      animation-timing-function: linear;
    }
    /* BURN — the mask eats upward from the ignition corner (see
       pop-burn-r); the shrinking remains ride the same line. */
    46% {
      transform: translateY(-20px) rotate(calc(var(--card-tilt) - 13deg)) scale(0.56);
    }
    62% {
      transform: translateY(-28px) rotate(calc(var(--card-tilt) - 17deg)) scale(0.42);
    }
    76% {
      transform: translateY(-38px) rotate(calc(var(--card-tilt) - 20deg)) scale(0.28);
      opacity: 1;
      animation-timing-function: var(--ease-lift);
    }
    79.9% {
      filter: url("#pop-crumple-deep");
    }
    /* DRIFT — the wrinkle lets go, the ember core rises and thins out. */
    80% {
      filter: none;
    }
    93% {
      opacity: 0;
    }
    100% {
      transform: translateY(-120px) rotate(calc(var(--card-tilt) - 28deg)) scale(0.08);
      opacity: 0;
    }
  }

  /* The burn radius driver — the ONE value both burn consumers (the
     eating mask, the fire rim) read, so paper edge and fire line can never
     separate. Idle far below zero until ignition (a negative radius is no
     hole at all), then a catch-then-consume ramp past the farthest corner
     (100%) to 150% so the feather fully clears the paper. */
  @keyframes pop-burn-r {
    0%,
    37% {
      --burn-r: -8%;
      animation-timing-function: cubic-bezier(0.55, 0.1, 0.85, 0.4);
    }
    78%,
    100% {
      --burn-r: 150%;
    }
  }

  /* The paper's own metamorphosis: color slides from the note's token
     toward ember (color-mix keeps every intermediate value token-derived),
     corners balloon into the crumpled ball. Keyframes pair with the master
     timeline's phases by percentage — same clock, no drift. */
  @keyframes pop-paper {
    0%,
    26% {
      background: var(--card-color);
      border-radius: var(--radius-note);
    }
    38% {
      background: color-mix(in srgb, var(--card-color) 55%, var(--ember));
      border-radius: 30px;
    }
    52% {
      background: color-mix(in srgb, var(--ember) 68%, var(--card-color));
      border-radius: 38px;
    }
    68% {
      background: var(--ember);
      border-radius: 46px;
    }
    82%,
    100% {
      background: var(--ember-deep);
      border-radius: 50%;
    }
  }

  /* The fire line exists only while the burn runs: dark before ignition
     (its pre-radius stops would otherwise paint a disc at the corner),
     bright through the consume, gone as the last paper goes. */
  @keyframes pop-burn-front {
    0%,
    36% {
      opacity: 0;
    }
    42% {
      opacity: 1;
    }
    72% {
      opacity: 1;
    }
    86%,
    100% {
      opacity: 0;
    }
  }

  /* The ink dies as the ball forms — handwriting crumpling into the wad,
     not lingering on the fire. */
  @keyframes pop-ink {
    0%,
    22% {
      opacity: 1;
    }
    31%,
    100% {
      opacity: 0;
    }
  }

  /* One spark's flight: fade in fast, curve outward on the way up
     (the 55% waypoint is 55–60% of the total drift — a bend, not a
     straight line), shrink to nothing. Transform order is fixed so
     segments interpolate per-function. */
  @keyframes pop-ember {
    0% {
      transform: translate(0, 0) scale(0.3);
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    55% {
      transform: translate(calc(var(--edx) * 0.55), calc(var(--erise) * 0.6)) scale(0.9);
      opacity: 0.9;
    }
    100% {
      transform: translate(var(--edx), var(--erise)) scale(0.1);
      opacity: 0;
    }
  }

  /* Reduced motion (DESIGN.md §7 "every animation becomes a simple fade";
     TASKS.md T29 done-when): the ghost simply fades out — no transform, no
     mask (the radius never ramps, and we take the mask off regardless), no
     filter passes, no embers, no fire line. The fade is named
     pop-ceremony-fade so the ghost's animationend contract (see
     onAnimationEnd) covers it. */
  @media (prefers-reduced-motion: reduce) {
    .pop-ghost {
      animation: pop-ceremony-fade var(--motion-fade) both;
      will-change: auto;
    }
    @keyframes pop-ceremony-fade {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
    .burn-box {
      animation: none;
      mask-image: none;
    }
    .burn-front,
    .embers {
      display: none;
    }
    .pop-ghost-text {
      animation: none;
    }
  }
</style>
