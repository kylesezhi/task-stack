<script lang="ts">
  /**
   * ArchiveView mechanics (T21; sources: TASKS.md T21, DESIGN.md §5.6,
   * DECISIONS.md §6/§11) — the proof-of-accomplishment sheet, deliberately
   * plain: the global completed list grouped by local calendar day (Today /
   * Yesterday / dated), each row note text + a stack-name chip ("Work") +
   * a local time ("11:42"), newest first. No stats, no charts, no streaks —
   * the header chrome ("Archive", "{doneCount} done", Close) and the .overlay
   * structure are T16's, kept as built; "{N} done" is never pluralized
   * ("1 done" is correct prose here). The chip is mechanics only — a plain
   * quiet pill; the real §5.6 chip visuals are T32.
   *
   * No local state, no effects: `groups` is one $derived over the snapshot
   * via the pure groupCompletedByDay (lib/archive.ts), so the sheet is
   * WS-live by construction — server truth drives the UI (DECISIONS.md §11),
   * exactly like the other sheets. Each $derived recompute takes a fresh
   * clock, so a day rollover relabels on the next snapshot (no ticking
   * clock; accepted in archive.ts's head comment).
   */
  import { snapshot } from "../lib/store";
  import { closeOverlay } from "../lib/view";
  import { formatCompletedTime, groupCompletedByDay } from "../lib/archive";

  const doneCount = $derived($snapshot?.completed.length ?? 0);
  const groups = $derived(groupCompletedByDay($snapshot?.completed ?? []));
</script>

<section class="overlay">
  <header>
    <h2>Archive</h2>
    <p class="done">{doneCount} done</p>
    <button type="button" onclick={closeOverlay}>Close</button>
  </header>
  <!-- One-<main>-rule: StackView stays mounted beneath this sheet and keeps
       the document's only <main>; sheets are dialogs, not mains. Full focus
       management (inert background, aria-modal) is deferred to T33. -->
  <div class="body">
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
                <span class="note-text">{entry.text}</span>
                <!-- Mechanics-only chip; denormalized stackName survives
                     stack deletion (stackId may be null, T10). -->
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

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .done {
    margin: 0;
    color: var(--ink-quiet);
  }

  header button {
    margin-left: auto;
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  /* Grouped day columns — the same register as ListView's .rows. */
  .day {
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  h3 {
    margin: 0;
    font-size: 0.9rem;
  }

  .day ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  /* Minimal readable rows — the paper look is T32. */
  .entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--paper-edge);
  }

  .note-text {
    /* DESIGN.md §2: archive note text stays handwritten, slightly faded —
       Caveat for the hand, --ink-faded for the older-day ink. */
    font-family: var(--font-hand);
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

  .chip {
    border: 1px solid var(--paper-edge);
    border-radius: 0.25rem;
    padding: 0.05rem 0.4rem;
    /* var(--ink-muted): the quiet-ink floor for real copy (the stack's
       name), per the old #555 comment — the token is darker, so AA holds. */
    color: var(--ink-muted);
    font-size: 0.75rem;
    /* T28 worst-case guard (§9): the chip keeps nowrap (a wrapped chip
       reads as a broken pill), so a valid 80-char unbroken stack name
       (~480px) must be ELLIPSIZED instead of stretching its ~366px entry
       into a sheet h-scroll at 390. Division of labor across the entry
       (the round-2 squeeze bug: with a shrinkable chip a NORMAL name
       rendered as "Wo…" whenever a long note text competed for space):
       the note text is the yielding slot (min-width: 0 + overflow-wrap
       — it wraps to more lines first); chip and time are RIGID
       (flex: 0 0 auto — never shrunk below their content); and the
       chip's ONLY truncation path is its own max-width: 40% + ellipsis
       clamp, which fires solely when the chip itself exceeds the clamp
       (the 80-char case). This is the overflow guard only — T32 owns
       the chip's real §5.6 visuals. */
    flex: 0 0 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    /* Muted metadata, not copy (ListView's disabled row-actions precedent):
       --ink-quiet, the quietest step below --ink-muted. */
    color: var(--ink-quiet);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    /* Rigid slot, same division of labor as .chip above: the note text
       yields, the time never shrinks below its own content. */
    flex: 0 0 auto;
  }

  .empty {
    /* var(--ink-muted), not a lighter gray: real copy's quiet-ink floor
       (ListView precedent; the token is darker than the old #555, so the
       ≥ WCAG AA rationale holds a fortiori). */
    color: var(--ink-muted);
    font-size: 0.9rem;
  }
</style>
