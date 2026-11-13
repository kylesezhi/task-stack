<script lang="ts">
  /**
   * ArchiveView (T21 mechanics + T32 polish; sources: TASKS.md T21/T32,
   * DESIGN.md §5.6, DECISIONS.md §6/§11) — the proof-of-accomplishment
   * sheet, deliberately plain: the global completed list grouped by local
   * calendar day (Today / Yesterday / dated), each row note text + a
   * stack-name chip ("Work") + a local time ("11:42"), newest first. No
   * stats, no charts, no streaks — "the plainness is the point". The T32
   * layer (web/src/sheets.css) turns the old T16 mechanics shell into the
   * shared paper sheet (scrim .overlay + .sheet, slide via lib/sheet-motion,
   * reduced motion → fade); this file adds §5.6's ledger details: day
   * headings with a hairline rule, quiet paper chips, faded handwriting,
   * boxless ledger rows. "{N} done" is never pluralized ("1 done" is
   * correct prose here).
   *
   * No local state, no effects: `groups` is one $derived over the snapshot
   * via the pure groupCompletedByDay (lib/archive.ts), so the sheet is
   * WS-live by construction — server truth drives the UI (DECISIONS.md §11),
   * exactly like the other sheets. Each $derived recompute takes a fresh
   * clock, so a day rollover relabels on the next snapshot (no ticking
   * clock; accepted in archive.ts's head comment).
   */
  import { fade } from "svelte/transition";
  import { snapshot } from "../lib/store";
  import { closeOverlay } from "../lib/view";
  import { formatCompletedTime, groupCompletedByDay } from "../lib/archive";
  import { sheetIn, sheetOut } from "../lib/sheet-motion";

  const doneCount = $derived($snapshot?.completed.length ?? 0);
  const groups = $derived(groupCompletedByDay($snapshot?.completed ?? []));
</script>

<!-- The scrim fades in only (`in:fade`, a plain 160ms backdrop veil) — an
     intro-only transition's out() is a no-op, so the overlay is never
     marked inert; the still-mounted scrim keeps blocking desk input until
     the sheet's outro finishes and the block is removed, while the sheet
     subtree itself is inert during its slide-out. The SHEET slides
     (lib/sheet-motion; reduced motion → fade). -->
<div class="overlay" in:fade={{ duration: 160 }}>
  <section class="sheet" in:sheetIn={{ y: 20 }} out:sheetOut={{ y: 12 }}>
    <header class="sheet-header">
      <h2 class="sheet-heading">Archive</h2>
      <span class="sheet-count">{doneCount} done</span>
      <button type="button" class="sheet-close" onclick={closeOverlay}>Close</button>
    </header>
    <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
         the document's only <main>; sheets are dialogs, not mains. Full focus
         management (inert background, aria-modal) is deferred to T33. -->
    <div class="sheet-body">
      {#if groups.length === 0}
        <!-- DESIGN.md §5.6's archive empty copy, exact. -->
        <p class="empty">Nothing done yet. Push something.</p>
      {:else}
        {#each groups as group (group.key)}
          <section class="day">
            <h3>{group.label}</h3>
            <ul>
              {#each group.entries as entry (entry.id)}
                <li class="entry">
                  <!-- .note-text is a durable e2e locator — the class lives
                       where the TEXT lives. -->
                  <span class="note-text">{entry.text}</span>
                  <!-- Denormalized stackName survives stack deletion
                       (stackId may be null, T10). -->
                  <span class="chip">{entry.stackName}</span>
                  <!-- Raw ISO in datetime, local "11:42" as the visible text. -->
                  <time class="time" datetime={entry.completedAt}>
                    {formatCompletedTime(entry.completedAt)}
                  </time>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
  </section>
</div>

<style>
  /* The body is one ledger column; the day groups stack inside it. Padding
     and the paper background come from the shared layer (sheets.css). */
  .sheet-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-md);
  }

  .day {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  /* Day heading: quiet sans, ink-body, and the §5.6 ledger hairline that
     runs out to the sheet's right edge after the label. Labels stay as
     produced (never uppercased — "Today", "Jun 14, 2024" are prose). */
  .day h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-label-md);
    font-weight: 600;
    color: var(--ink-body);
  }

  .day h3::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--paper-edge);
  }

  .day ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  /* Flat ledger entries, no box around each row (§5.6: the plainness IS
     the look) — the row is a baseline-aligned line of handwriting, chip,
     time, lifted only by the warm tone on hover/focus. */
  .entry {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    padding: var(--space-sm);
    border-radius: var(--radius-note);
    transition: background-color 120ms var(--ease-lift);
  }

  .entry:hover,
  .entry:focus-within {
    background: var(--paper-warm);
  }

  /* On a hovered entry the chip inverts to plain paper so it never blends
     into the warm row tone beneath it. */
  .entry:hover .chip,
  .entry:focus-within .chip {
    background: var(--paper);
  }

  .note-text {
    /* DESIGN.md §2/§5.6: archive note text stays handwritten, slightly
       faded and smaller than the desk's handwriting — Caveat for the hand,
       --ink-faded for the older-day ink. */
    font-family: var(--font-hand);
    font-size: 1.2rem;
    line-height: 1.3;
    font-weight: 500;
    color: var(--ink-faded);
    /* T28 worst-case guard (§9; NOTE_TEXT_MAX_LENGTH): a 280-char
       unbroken token must wrap, not open a horizontal scrollbar in the
       sheet at 390px. `anywhere` also shrinks the span's min-content
       size, so the flex row (.entry) can shrink it below the token —
       and min-width: 0 makes THIS span the row's yielding slot: it
       shrinks and wraps to more lines before chip or time move (the
       entry's left-packed look stays — no flex: 1 here, deliberately:
       that would push chip/time to the right edge). */
    overflow-wrap: anywhere;
    min-width: 0;
  }

  /* The §5.6 chip: a quiet paper pill — warm paper, hairline edge, muted
     ink — carrying the stack's name. */
  .chip {
    background: var(--paper-warm);
    border: 1px solid var(--paper-edge);
    border-radius: var(--radius-note);
    padding: 0.05rem 0.4rem;
    /* var(--ink-muted): the quiet-ink floor for real copy (the stack's
       name), per the old #555 comment — the token is darker, so AA holds. */
    color: var(--ink-muted);
    font-size: var(--text-label-md);
    /* T28 worst-case guard (§9): the chip keeps nowrap (a wrapped chip
       reads as a broken pill), so a valid 80-char unbroken stack name
       (~480px) must be ELLIPSIZED instead of stretching its entry into a
       sheet h-scroll at 390. Division of labor across the entry (the
       round-2 squeeze bug: with a shrinkable chip a NORMAL name rendered
       as "Wo…" whenever a long note text competed for space): the note
       text is the yielding slot (min-width: 0 + overflow-wrap — it wraps
       to more lines first); chip and time are RIGID (flex: 0 0 auto —
       never shrunk below their content); and the chip's ONLY truncation
       path is its own max-width: 40% + ellipsis clamp, which fires solely
       when the chip itself exceeds the clamp (the 80-char case). This
       clamp is the overflow guard, delivered with the T32 chip visuals. */
    flex: 0 0 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    /* Muted metadata, not copy (ListView's disabled row-actions precedent):
       --ink-quiet, the quietest step below --ink-muted; tabular-nums keeps
       the ledger's time column visually even. */
    color: var(--ink-quiet);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    /* Rigid slot, same division of labor as .chip above: the note text
       yields, the time never shrinks below its own content. */
    flex: 0 0 auto;
  }

  .empty {
    margin: 0;
    width: 100%;
    text-align: center;
    /* Generous vertical air — the empty sheet is a resting surface. */
    padding: var(--space-xl) 0;
    /* var(--ink-muted), not a lighter gray: real copy's quiet-ink floor
       (ListView precedent; the token is darker than the old #555, so the
       ≥ WCAG AA rationale holds a fortiori). */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }
</style>
