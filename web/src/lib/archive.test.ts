/**
 * Unit tests for the pure archive grouping + time formatting (T21; sources:
 * TASKS.md T21, DESIGN.md §5.6). groupCompletedByDay is framework-free and
 * DOM-free, so these run in Node (vitest.config.ts) like reorder.test.ts.
 *
 * TZ-safe construction pattern everywhere: timestamps are built via
 * `new Date(y, m, d, h, min)` in the RUNNER'S LOCAL time and fed through
 * `.toISOString()` (the server shape), and day-level cases use local noon
 * so they pass in any runner timezone. `now` is always passed explicitly —
 * the clock must never be a co-test variable.
 */
import { describe, expect, it } from "vitest";
import type { CompletedNote } from "@task-stack/shared";
import { formatCompletedTime, groupCompletedByDay } from "./archive";

/** 1-based month for readability; local wall-clock → server-shaped ISO. */
function localISO(
  year: number,
  month: number,
  date: number,
  hour: number,
  minute: number = 0,
): string {
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

/** A server-shaped CompletedNote with quiet defaults for the fields a test
 * doesn't care about. */
function entry(
  overrides: Partial<CompletedNote> & Pick<CompletedNote, "id" | "completedAt">,
): CompletedNote {
  return {
    text: `note ${overrides.id}`,
    stackId: null,
    stackName: "Work",
    createdAt: overrides.completedAt,
    ...overrides,
  };
}

describe("groupCompletedByDay", () => {
  it("returns [] for empty input", () => {
    const now = new Date(2026, 9, 26, 12); // local noon
    expect(groupCompletedByDay([], now)).toEqual([]);
  });

  it("pairs three scrambled days into three groups, newest day first, entries newest-first within each group", () => {
    const now = new Date(2026, 9, 26, 12); // Oct 26 local noon
    const input = [
      entry({ id: "t2", completedAt: localISO(2026, 10, 26, 9, 30) }), // today, older
      entry({ id: "o1", completedAt: localISO(2026, 10, 12, 18, 0) }), // Oct 12
      entry({ id: "t1", completedAt: localISO(2026, 10, 26, 15, 0) }), // today, newer
      entry({ id: "m2", completedAt: localISO(2026, 10, 20, 8, 0) }), // Oct 20, older
      entry({ id: "m1", completedAt: localISO(2026, 10, 20, 20, 0) }), // Oct 20, newer
      entry({ id: "o2", completedAt: localISO(2026, 10, 12, 7, 15) }), // Oct 12, older
    ];
    const groups = groupCompletedByDay(input, now);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Oct 20", "Oct 12"]);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["t1", "t2"]);
    expect(groups[1]?.entries.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(groups[2]?.entries.map((e) => e.id)).toEqual(["o1", "o2"]);
  });

  it("ties same-instant completions by id ASC — mirroring server truth's ORDER BY completed_at DESC, id ASC", () => {
    const now = new Date(2026, 9, 26, 12);
    const sameInstant = localISO(2026, 10, 26, 11, 0);
    // Scrambled on purpose: "b" first in the input, server sorts ids ASC.
    const groups = groupCompletedByDay(
      [entry({ id: "b", completedAt: sameInstant }), entry({ id: "a", completedAt: sameInstant })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("labels crushed-midnight completions Yesterday: yesterday 23:59 with now today 00:01 (calendar-day rule, not 24h)", () => {
    const now = new Date(2026, 9, 26, 0, 1); // today 00:01 local
    const groups = groupCompletedByDay(
      [entry({ id: "x", completedAt: localISO(2026, 10, 25, 23, 59) })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Yesterday");
  });

  it("labels a year-rollover completion Yesterday — precedence over the dated label (Dec 31 2025, now Jan 1 2026)", () => {
    const now = new Date(2026, 0, 1, 12); // Jan 1 2026 local noon
    const groups = groupCompletedByDay(
      [entry({ id: "x", completedAt: localISO(2025, 12, 31, 12) })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Yesterday");
  });

  it("labels a month-rollover completion Yesterday (Feb 28, now Mar 1)", () => {
    const now = new Date(2026, 2, 1, 12); // Mar 1 local noon
    const groups = groupCompletedByDay(
      [entry({ id: "x", completedAt: localISO(2026, 2, 28, 12) })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Yesterday");
  });

  it("labels same-year older dates without a year and non-adjacent different-year dates with one", () => {
    const now = new Date(2026, 9, 26, 12); // Oct 26 2026 local noon
    const groups = groupCompletedByDay(
      [
        entry({ id: "older", completedAt: localISO(2026, 10, 14, 12) }),
        entry({ id: "ancient", completedAt: localISO(2024, 6, 14, 12) }),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(["Oct 14", "Jun 14, 2024"]);
  });

  it("keys groups by local zero-padded YYYY-MM-DD (exact strings, locale-free)", () => {
    const now = new Date(2026, 9, 26, 12);
    const groups = groupCompletedByDay(
      [
        entry({ id: "a", completedAt: localISO(2026, 10, 5, 9, 45) }),
        entry({ id: "b", completedAt: localISO(2024, 6, 14, 12) }),
      ],
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(["2026-10-05", "2024-06-14"]);
  });

  it("never mutates the input array, even for a full re-sort", () => {
    const now = new Date(2026, 9, 26, 12);
    const input = [
      entry({ id: "b", completedAt: localISO(2026, 10, 12, 18, 0) }),
      entry({ id: "a", completedAt: localISO(2026, 10, 26, 15, 0) }),
    ];
    const frozen = Object.freeze([...input]) as readonly CompletedNote[];
    expect(groupCompletedByDay(frozen, now)).toHaveLength(2);
    // The input's original (scrambled) order is untouched.
    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("formatCompletedTime", () => {
  it("formats local wall-clock times as fixed en-US h23", () => {
    // Construct LOCAL, feed the ISO the server would send back.
    expect(formatCompletedTime(localISO(2026, 10, 26, 11, 42))).toBe("11:42");
    expect(formatCompletedTime(localISO(2026, 10, 26, 23, 42))).toBe("23:42");
  });
});
