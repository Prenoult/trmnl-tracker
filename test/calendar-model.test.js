// The calendar's date maths, isolated from the table it feeds. The failure this
// suite exists for: a month/week miscount that silently circles the wrong day —
// nothing would ever throw, the page would just be quietly wrong.

import { describe, it, expect } from "vitest";

import { buildCalendarModel } from "../lib/calendar-model.js";
import { addDays, parseDay } from "../lib/domain.js";

const iso = (d) => d.toISOString().slice(0, 10);
const flatDays = (model) => model.weeks.flat();

describe("buildCalendarModel", () => {
  it("has nothing to draw without a target date", () => {
    expect(buildCalendarModel("2026-08-16", null, null)).toBeNull();
  });

  it("starts the grid on the Monday of the week the 1st falls in", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on 31 August.
    const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
    expect(iso(model.weeks[0][0].date)).toBe("2026-08-31");
    expect(model.weeks[0][0].inMonth).toBe(false);
  });

  it("ends the grid on the Sunday of the week the last day falls in", () => {
    // 30 September 2026 is a Wednesday, so the grid closes on 4 October.
    const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
    const lastWeek = model.weeks[model.weeks.length - 1];
    expect(iso(lastWeek[lastWeek.length - 1].date)).toBe("2026-10-04");
    expect(lastWeek[lastWeek.length - 1].inMonth).toBe(false);
  });

  it("keeps every week exactly seven days, Monday first", () => {
    const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
    for (const week of model.weeks) {
      expect(week).toHaveLength(7);
      expect(week[0].date.getUTCDay()).toBe(1); // Monday
      expect(week[6].date.getUTCDay()).toBe(0); // Sunday
    }
  });

  it("marks exactly one day as the target", () => {
    const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
    const targets = flatDays(model).filter((d) => d.isTarget);
    expect(targets).toHaveLength(1);
    expect(iso(targets[0].date)).toBe("2026-09-16");
    expect(targets[0].inMonth).toBe(true);
  });

  it("marks today only when it falls inside the drawn month", () => {
    const inMonth = buildCalendarModel("2026-09-03", parseDay("2026-09-16"), null);
    expect(flatDays(inMonth).filter((d) => d.isToday)).toHaveLength(1);

    // A month away, as the ETA usually is: today never appears in the grid.
    const outOfMonth = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
    expect(flatDays(outOfMonth).filter((d) => d.isToday)).toHaveLength(0);
  });

  describe("the range band", () => {
    it("shades every day from earliest to latest, inclusive", () => {
      const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), {
        earliest: parseDay("2026-09-13"),
        latest: parseDay("2026-09-19"),
      });
      const shaded = flatDays(model)
        .filter((d) => d.inRange)
        .map((d) => iso(d.date));
      expect(shaded).toEqual([
        "2026-09-13",
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
        "2026-09-19",
      ]);
      expect(model.openEnded).toBe(false);
      expect(model.clippedBefore).toBe(false);
      expect(model.clippedAfter).toBe(false);
    });

    it("shades nothing without a range", () => {
      const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), null);
      expect(flatDays(model).some((d) => d.inRange)).toBe(false);
    });

    it("reaches the drawn edge, not a real date, on an open-ended range", () => {
      // The slow end of a range that allows a standstill: shippingEstimate
      // reports latest as null rather than "never".
      const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), {
        earliest: parseDay("2026-09-10"),
        latest: null,
      });
      expect(model.openEnded).toBe(true);
      expect(model.clippedAfter).toBe(false);
      const lastWeek = model.weeks[model.weeks.length - 1];
      expect(lastWeek[lastWeek.length - 1].inRange).toBe(true);
    });

    it("says so when the real range reaches past the drawn month", () => {
      const model = buildCalendarModel("2026-08-16", parseDay("2026-09-16"), {
        earliest: parseDay("2026-08-20"), // before the grid opens on 31 Aug
        latest: parseDay("2026-10-20"), // after the grid closes on 4 Oct
      });
      expect(model.clippedBefore).toBe(true);
      expect(model.clippedAfter).toBe(true);
      // Every drawn day between the two is still shaded, capped at the edges
      // rather than left blank because the true bound sits off the page.
      expect(flatDays(model).every((d) => d.inRange)).toBe(true);
    });
  });

  it("crosses a year boundary without losing a day", () => {
    // December 2026: the grid opens 30 November and, since 31 December is a
    // Thursday, closes 3 January 2027.
    const model = buildCalendarModel("2026-12-01", parseDay("2026-12-25"), null);
    const first = model.weeks[0][0];
    const lastWeek = model.weeks[model.weeks.length - 1];
    const last = lastWeek[lastWeek.length - 1];
    expect(iso(first.date)).toBe("2026-11-30");
    expect(iso(last.date)).toBe("2027-01-03");
    expect(last.inMonth).toBe(false);

    // No gaps and no repeats across the whole grid, including the flip from
    // day 31 to day 1 in the middle of it.
    const all = flatDays(model);
    for (let i = 1; i < all.length; i++) {
      expect(iso(addDays(all[i - 1].date, 1))).toBe(iso(all[i].date));
    }
  });

  it("covers a leap-year February without dropping the 29th", () => {
    const model = buildCalendarModel("2024-02-01", parseDay("2024-02-16"), null);
    const feb29 = flatDays(model).find((d) => iso(d.date) === "2024-02-29");
    expect(feb29).toBeDefined();
    expect(feb29.inMonth).toBe(true);
  });
});
