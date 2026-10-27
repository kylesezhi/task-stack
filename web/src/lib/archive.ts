/**
 * Pure archive grouping + time formatting (T21; sources: TASKS.md T21,
 * DESIGN.md §5.6, DECISIONS.md §6/§11).
 *
 * Semantics —
 *
 * Day grouping is by the runtime's LOCAL calendar day (the archive's "Today"
 * is the user's day): each entry's `new Date(completedAt)` is compared with
 * `now` on year/month/date only — never on elapsed time, so "yesterday
 * 23:59 → today 00:01" is still the Yesterday group.
 *
 * Label precedence: Today → Yesterday → dated. "Yesterday" is the calendar
 * day of `now` minus one, computed DST-safely via noon normalization —
 * `new Date(y, m, d - 1, 12)` — because no DST transition happens at noon
 * anywhere and the Date constructor normalizes day underflow across month
 * and year boundaries (Dec 31 completed with now Jan 1 2026 is "Yesterday",
 * not "Dec 31, 2025"). Dated labels: "Oct 14" for the same year, "Jun 14,
 * 2024" (year suffix) when the completed year differs from now's.
 *
 * Locale is FIXED "en-US" for labels and times, deliberately: all app copy
 * is English (DESIGN.md §6's microcopy voice), a fixed locale keeps the
 * archive deterministic across devices and test runners (the e2e suite
 * asserts exact labels like "Jun 14, 2024"), and localization is not a v1
 * concern.
 *
 * Ordering: a COPY of the input is sorted by `Date.parse(completedAt)`
 * descending, tie-break id ascending — deliberately mirroring server truth's
 * `ORDER BY completed_at DESC, id ASC` (server/src/state.ts), using the same
 * filter-then-sort-a-copy precedent as StackView/ListView. The input array
 * is NEVER mutated (snapshot arrays must not be sorted in place anywhere in
 * this app). Groups emerge in first-encounter order (newest day first) and
 * entries within a group stay newest first.
 *
 * Input is server-shaped (ISO from `toISOString()`, shared/src/types.ts).
 * No garbage tolerance is built in, deliberately — but be precise about
 * what malformed input would do: the intermediate steps degrade quietly
 * (an unparseable `completedAt` makes `dayKey` emit a NaN-keyed string and
 * the Today/Yesterday comparisons come out simply false), but group
 * construction immediately calls `dayLabel`, whose dated branch formats the
 * invalid Date — and Intl cannot format a NaN time — so
 * `groupCompletedByDay` THROWS `RangeError: Invalid time value` on the first
 * unparseable timestamp (it never returns a NaN-keyed group);
 * `formatCompletedTime` throws the same way. That is unreachable with
 * server-shaped input: `completedAt` is always the server's `toISOString()`
 * output. No guard is added for it — dead defensiveness for impossible
 * input is not this repo's pattern; the guards that matter (null snapshot,
 * missing rows) live in the component, per the "a view must never crash on
 * a missing row" precedent.
 *
 * `now` defaults to `new Date()` and is read ONCE per call: every `$derived`
 * recompute takes a fresh clock shot, so a day rollover self-heals the next
 * time a WS snapshot arrives. There is dangerously no ticking clock — an
 * archive left open past midnight keeps yesterday's labels until the next
 * snapshot; accepted for v1 (T33's session polish may revisit).
 *
 * Framework-free and DOM-free (imports only the CompletedNote type) so it
 * loads in Node under vitest, like reorder.ts / view-state.ts.
 */
import type { CompletedNote } from "@task-stack/shared";

/** One local calendar day of completions, newest entry first. */
export interface CompletedGroup {
  /** Local calendar day, zero-padded and locale-free — keyed-each key. */
  key: string; // "2026-10-26"
  /** "Today" | "Yesterday" | "Oct 14" | "Jun 14, 2024" (fixed en-US). */
  label: string;
  /** This day's completed notes, newest first. */
  entries: CompletedNote[];
}

// Fixed en-US formatters (rationale in the head comment). Module-scope and
// lazily built so the vitest Node run pays nothing when it never formats.
const datedFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const datedWithYearFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

export function groupCompletedByDay(
  completed: readonly CompletedNote[],
  now: Date = new Date(),
): CompletedGroup[] {
  if (completed.length === 0) return [];

  // Sort a copy — never the snapshot. Server-truth mirror: completed_at DESC,
  // id ASC (same-instant completions tie-break deterministically).
  const sorted = [...completed].sort((a, b) => {
    const byTime = Date.parse(b.completedAt) - Date.parse(a.completedAt);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const nowDate = now.getDate();
  // The calendar day before now, at noon — underflow across month/year
  // boundaries is normalized by the constructor, and noon is immune to DST.
  const yesterday = new Date(nowYear, nowMonth, nowDate - 1, 12);

  const groups: CompletedGroup[] = [];
  const byKey = new Map<string, CompletedGroup>();

  for (const entry of sorted) {
    const at = new Date(entry.completedAt);
    const key = dayKey(at);
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, label: dayLabel(at, now, yesterday), entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** Local "11:42" / "23:42" / "0:05" — fixed en-US, h23 (DESIGN.md §5.6). */
export function formatCompletedTime(completedAt: string): string {
  return timeFormat.format(new Date(completedAt));
}

/** Local zero-padded "YYYY-MM-DD", locale-free (the keyed-each key). */
function dayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const date = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${date}`;
}

/** Today → Yesterday → dated (year suffix only when the year differs). */
function dayLabel(at: Date, now: Date, yesterday: Date): string {
  if (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  ) {
    return "Today";
  }
  if (
    at.getFullYear() === yesterday.getFullYear() &&
    at.getMonth() === yesterday.getMonth() &&
    at.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  // All app copy is English (DESIGN.md §6); fixed en-US keeps the labels
  // deterministic across devices and test runners.
  return at.getFullYear() === now.getFullYear()
    ? datedFormat.format(at)
    : datedWithYearFormat.format(at);
}
