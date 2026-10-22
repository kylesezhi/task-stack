---
name: Warm Paper Skeuomorphism
colors:
  surface: '#fbf9f3'
  surface-dim: '#dcdad4'
  surface-bright: '#fbf9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ed'
  surface-container: '#f0eee8'
  surface-container-high: '#eae8e2'
  surface-container-highest: '#e4e2dd'
  on-surface: '#1b1c18'
  on-surface-variant: '#5a413b'
  inverse-surface: '#30312d'
  inverse-on-surface: '#f3f1eb'
  outline: '#8e706a'
  outline-variant: '#e2bfb7'
  surface-tint: '#b22c0f'
  primary: '#ae2a0c'
  on-primary: '#ffffff'
  primary-container: '#d14224'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb4a4'
  secondary: '#67601b'
  on-secondary: '#ffffff'
  secondary-container: '#efe591'
  on-secondary-container: '#6d6620'
  tertiary: '#625b53'
  on-tertiary: '#ffffff'
  tertiary-container: '#7b736b'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad3'
  primary-fixed-dim: '#ffb4a4'
  on-primary-fixed: '#3d0600'
  on-primary-fixed-variant: '#8c1800'
  secondary-fixed: '#efe591'
  secondary-fixed-dim: '#d2c978'
  on-secondary-fixed: '#1f1c00'
  on-secondary-fixed-variant: '#4e4802'
  tertiary-fixed: '#ece1d7'
  tertiary-fixed-dim: '#cfc5bb'
  on-tertiary-fixed: '#201b15'
  on-tertiary-fixed-variant: '#4c463e'
  background: '#fbf9f3'
  on-background: '#1b1c18'
  surface-variant: '#e4e2dd'
typography:
  display-lg:
    fontFamily: Epilogue
    fontSize: 34px
    fontWeight: '500'
    lineHeight: 44px
    letterSpacing: -0.01em
  display-lg-mobile:
    fontFamily: Epilogue
    fontSize: 26px
    fontWeight: '500'
    lineHeight: 34px
  headline-lg:
    fontFamily: Epilogue
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 38px
  headline-lg-mobile:
    fontFamily: Epilogue
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 30px
  headline-md:
    fontFamily: Epilogue
    fontSize: 22px
    fontWeight: '400'
    lineHeight: 30px
  body-lg:
    fontFamily: Epilogue
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 2.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system evokes the serene, tactile focus of an uncluttered physical desk bathed in natural morning light. Crafted for deliberate thinkers, writers, and individuals overwhelmed by hyper-quantified productivity tools, it deliberately strips away modern corporate anxieties—jargon, notification badges, rigid tabular grids, overdue warnings, and mechanical checkboxes.

The visual style blends refined paper skeuomorphism with warm minimalist restraint:
- **Materiality over Flatness**: UI surfaces behave like genuine cellulose, grain, and adhesive paper notes rather than illuminated glass pixels.
- **Physical Imperfection**: Subtle rotational shifts (ranging from ±1.5° to ±4° on mobile, up to ±6° on desktop decks) and alternating peeking edges convey items gently arranged by hand.
- **Quiet Analog Presence**: Interactions mirror dry ink sinking into fibrous paper, soft pressure-sensitive stamps, and effortless sticky-note peeling.

## Colors

The palette is strictly light-mode, grounded in parchment, natural sticky papers, and authentic pigments. Dark mode is intentionally unsupported to preserve the honest material properties of sunlit paper and fountain ink.

### Environment & Surfaces
- **Desk Ground Canvas**: `#F8F6F0` (warm parchment linen off-white). A micro-vignette (`radial-gradient(ellipse at center, #FAF9F5 0%, #F1EDE3 100%)`) anchors the center focus.
- **Parchment Substrates**:
  - Canary Note: Base `#FEF39E`, Highlight `#FFF6A9`
  - Soft Peach Note: Base `#FED7AA`, Highlight `#FEE2B8`
  - Pale Mint Note: Base `#D1FAE5`, Highlight `#E2FCEF`
  - Pale Rose Note: Base `#FCE7F3`, Highlight `#FDF0F6`
  - Soft Lavender Note: Base `#EDE9FE`, Highlight `#F3F0FF`

### Inks & Actions
- **Primary Ink (Handwriting/Content)**: `#26211C` (deep walnut-black fountain ink).
- **Interface Ink (System Sans)**: `#736B63` (muted drafting pencil graphite).
- **Ghost/Tertiary Ink**: `#8C827A` resting, deepening to `#453E38` on interaction.
- **Stamp Ink (Primary Action / Complete)**: `#D94829` (warm vermilion red-orange stamp ink), deepening to `#C43B1E` on press.
- **Subtle Edges / Rulers**: `#E6E1D8`.

## Typography

Typography establishes an intentional contrast between organic note content and whisper-quiet chrome. 

- **Sticky Note Content**: Expressive, characterful, organic shapes rendered with warm line metrics. Text behaves like hand-inked thoughts with relaxed vertical rhythm and natural kerning.
- **Interface & Desk Chrome**: Set in clean, neutral geometric sans (`Inter`). Used strictly for micro-copy, toolbars, deck counts, and modal controls. Never intrusive; remains subordinate to the paper content.

## Layout & Spacing

The layout treats the browser window as an open physical tabletop. Elements sit unconstrained by rigid spreadsheet grids, using relaxed vertical stacks and floating layers.

### Layout Philosophy
- **Desk Viewports**: A fluid workspace bounded by safe zones. Maximum content width for standard reading stacks is `680px`, preventing visual fatigue and maintaining the physical proportions of authentic paper sheets.
- **Stacked Decks**: Items overlap along the Z-axis with alternating offsets (`+8px`, `-6px`, `+10px`) to replicate physical notes resting on one another.
- **Responsive Adaptations**:
  - **Desktop (1024px+)**: Generous canvas margins (`2.5rem`). Stack layers exhibit deliberate rotational variance (±2° to ±4°) and mouse-drag repositioning.
  - **Tablet (768px - 1023px)**: Center-aligned stack columns with reduced rotations (±1.5° to ±2°) to maintain legibility.
  - **Mobile (<768px)**: Rotations locked between -1° and +1° to preserve tap targets and edge padding. Margin decreases to `1rem`. Stacked notes peek upward with an `8px` top exposed edge rather than dynamic lateral overhangs.

## Elevation & Depth

Depth is tactile, physical, and warm. Synthetic grey drop-shadows and frosted glass blurs are strictly forbidden. Shadows use warm umber and amber undertones (`rgba(68, 52, 38, *)`), mimicking light passing through yellow-tinted fibers onto a wood/linen surface.

### Paper Shadow Hierarchy
- **Level 0 (Flat Note / Stack Base)**:
  `box-shadow: 0 1px 3px rgba(68, 52, 38, 0.06), 0 1px 2px rgba(50, 35, 20, 0.04);`
- **Level 1 (Stacked Note with Curl)**:
  Top glue edge: `linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 12px)`.
  Base paper lift: `box-shadow: 0 4px 10px rgba(68, 52, 38, 0.08), 0 1px 3px rgba(50, 35, 20, 0.06);`
- **Level 2 (Active / Peeling Note)**:
  Used when dragging, writing, or sorting:
  `box-shadow: 0 12px 28px rgba(68, 52, 38, 0.12), 0 4px 10px rgba(50, 35, 20, 0.06);`
  Transform lift: `scale(1.015) translateY(-4px)`.

### Paper Edges
Every note features a delicate, non-mechanical hairline border (`1px solid rgba(0, 0, 0, 0.05)`) paired with an inner top highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.6)`) that captures desk lamplight.

## Shapes

Paper corners are soft cut edges, not mechanical or circular pills. The system uses subtle radii (`4px` to `6px`) reflecting guillotined stationery cardstock.

- **Notes & Paper Sheets**: `0.25rem` (4px). Cleanly cropped with slight micro-irregularity.
- **Stamp Actions & Badges**: `0.375rem` (6px). Slightly rounded, simulating rubber stamps applied with manual pressure.
- **Desk Controls & Inputs**: `0.25rem` (4px) with hairline rules.

## Components

### Paper Notes (The Core Card)
- **Structure**: Aspect ratio roughly 1:1 or 4:3. Top `20px` represents the adhesive strip with a faint translucent sheen.
- **Borders & Edges**: `1px solid rgba(0, 0, 0, 0.06)` with a warm translucent lift.
- **State Changes**: On hover, the free bottom edge tilts forward slightly (`rotate(-0.5deg) translateY(-2px)`), deepening the bottom shadow.

### Vermilion Stamp Button ("Done" / Primary Action)
- **Visuals**: Styled as an inked rubber stamp. Heavy vermilion ink (`#D94829`) background with crisp off-white text (`#FFFDF9`) or raw vermilion border stamp on note paper.
- **Interaction**: Pressing down reduces scale (`scale(0.97)`) and produces a subtle ink-bleed animation, feeling like physical pressure into fiber. Hover: `#C43B1E`.
- **Exclusions**: No digital checkmark icons; uses tactile label verbs like "Finish", "Done", or "Clear".

### Interface Controls & Trays
- **New Note Palette**: Sits at the desk margin as a minimalist palette tray displaying the 5 paper swatches (Canary, Peach, Mint, Rose, Lavender) with natural paper textures.
- **Stack Counter / Metadata**: Muted graphite text (`#736B63`, `12px Inter`) with generous letter spacing, displayed like pencil notations along a blotter margin.
- **Desk Controls**: Iconography rendered with fine 1.25px strokes in muted ink (`#736B63`), transitioning to deep walnut `#26211C` on hover.

### Content Input
- Direct on-paper editing without bounding boxes or input outlines. Focusing on a note initiates a blinking walnut ink cursor directly on the paper substrate.
- Zero clutter: No calendar pickers, priority flags, tag pills, or due-date warnings.