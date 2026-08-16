// The queue arithmetic. These numbers are the reason this suite exists: nothing
// on the page lets you tell "+10 orders added" from "+40" by eye, so a sign error
// here would ship unnoticed.

import { describe, it, expect } from "vitest";

import { RATE_WINDOW_DAYS } from "../lib/config.js";
import {
  addDays,
  daysBetween,
  historicalRate,
  movement,
  parseDay,
  plural,
  shippingEstimate,
} from "../lib/domain.js";

const day = (date, position, total) => ({ date, position, total });
const iso = (d) => d.toISOString().slice(0, 10);

describe("parseDay / daysBetween / addDays", () => {
  it("reads dates as UTC midnight regardless of the local timezone", () => {
    expect(parseDay("2026-07-25").toISOString()).toBe("2026-07-25T00:00:00.000Z");
    // The bug this guards against: in a timezone west of Greenwich a locally
    // parsed date formats as the previous day.
    expect(parseDay("2026-07-25").getUTCDate()).toBe(25);
  });

  it("counts whole days across a DST transition", () => {
    // Europe/Paris springs forward on 2026-03-29, so one of these days is 23h
    // long in local time. Both dates are UTC midnights, so the answer is 2.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("counts whole days across a year boundary", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(iso(addDays(parseDay("2026-12-31"), 1))).toBe("2027-01-01");
  });

  it("returns zero for the same day and a negative count going backwards", () => {
    expect(daysBetween("2026-07-25", "2026-07-25")).toBe(0);
    expect(daysBetween("2026-07-25", "2026-07-23")).toBe(-2);
  });
});

describe("plural", () => {
  it("keeps zero and one singular, as French does", () => {
    expect(plural(0)).toBe("");
    expect(plural(1)).toBe("");
    expect(plural(-1)).toBe("");
  });

  it("pluralises from two upwards, and on fractions above one", () => {
    expect(plural(2)).toBe("s");
    expect(plural(1.5)).toBe("s");
    expect(plural(-3)).toBe("s");
  });

  it("carries the verb ending used for the summary sentence", () => {
    expect(plural(1, "en")).toBe("");
    expect(plural(12, "en")).toBe("en");
  });
});

describe("movement", () => {
  it("derives orders added from the queue delta, not from the totals alone", () => {
    // Real snapshots from the repository: the queue *shrank* by 20 while we moved
    // up 30 places, so 10 orders did join behind us. Comparing totals alone would
    // report -20 "added", which is the net balance, not the arrivals.
    const result = movement(day("2026-07-23", 1417, 1523), day("2026-07-24", 1387, 1503));
    expect(result).toEqual({ gained: 30, netAdded: 10, days: 1 });
  });

  it("reports zero added when the queue shrinks by exactly what we gained", () => {
    const result = movement(day("2026-07-01", 100, 200), day("2026-07-02", 90, 190));
    expect(result.gained).toBe(10);
    expect(result.netAdded).toBe(0);
  });

  it("adds arrivals on top of our gain when the queue grows", () => {
    const result = movement(day("2026-07-01", 100, 200), day("2026-07-02", 90, 210));
    expect(result).toEqual({ gained: 10, netAdded: 20, days: 1 });
  });

  it("goes negative when orders leave the queue from behind us", () => {
    // Real snapshots again: the queue shed 48 orders while we moved up only 5
    // places, so 43 of them left from *behind* our position — cancelled, refunded
    // or dropped by a recount. The figure is a net flow, not an arrival count,
    // and the page has to word it as such.
    const result = movement(day("2026-07-27", 1313, 1506), day("2026-07-28", 1308, 1458));
    expect(result).toEqual({ gained: 5, netAdded: -43, days: 1 });
  });

  it("reports a standstill as zero on both counts", () => {
    expect(movement(day("2026-07-01", 100, 200), day("2026-07-02", 100, 200))).toEqual({
      gained: 0,
      netAdded: 0,
      days: 1,
    });
  });

  it("handles our position slipping backwards", () => {
    const result = movement(day("2026-07-01", 90, 200), day("2026-07-02", 100, 200));
    expect(result.gained).toBe(-10);
    expect(result.netAdded).toBe(-10);
  });

  it("reports the real gap when the daily workflow skipped days", () => {
    expect(movement(day("2026-07-01", 100, 200), day("2026-07-04", 70, 180)).days).toBe(3);
  });

  it("floors the gap at one day so callers never divide by zero", () => {
    expect(movement(day("2026-07-01", 100, 200), day("2026-07-01", 95, 195)).days).toBe(1);
  });
});

describe("shippingEstimate", () => {
  it("has nothing to say before the second snapshot", () => {
    expect(shippingEstimate([])).toBeNull();
    expect(shippingEstimate([day("2026-07-23", 1417, 1523)])).toBeNull();
  });

  it("projects the current rate out to position zero", () => {
    const est = shippingEstimate([
      day("2026-07-23", 1417, 1523),
      day("2026-07-24", 1387, 1503),
    ]);
    expect(est.rate).toBe(30);
    expect(est.spanDays).toBe(1);
    expect(est.daysLeft).toBe(47); // ceil(1387 / 30)
    expect(iso(est.date)).toBe("2026-09-09");
  });

  it("gives no date when the queue has not moved", () => {
    const est = shippingEstimate([
      day("2026-07-23", 1417, 1523),
      day("2026-07-24", 1417, 1503),
    ]);
    expect(est).toEqual({ rate: 0, spanDays: 1, daysLeft: null, date: null, range: null });
    // A flat fit negates to -0, which the card would print as "-0 place/jour".
    expect(Object.is(est.rate, -0)).toBe(false);
  });

  it("gives no date when the queue moved backwards", () => {
    const est = shippingEstimate([
      day("2026-07-23", 1400, 1523),
      day("2026-07-24", 1417, 1503),
    ]);
    expect(est.rate).toBeLessThan(0);
    expect(est.daysLeft).toBeNull();
    expect(est.date).toBeNull();
  });

  it("drops the date past a ten-year horizon but still reports the day count", () => {
    const est = shippingEstimate([
      day("2026-07-23", 1_000_000, 1_000_000),
      day("2026-07-24", 999_999, 999_999),
    ]);
    expect(est.rate).toBe(1);
    expect(est.daysLeft).toBe(999_999);
    expect(est.date).toBeNull();
  });

  // Both sides of the cut-off, one day apart: a test only on the far side would
  // still pass if the horizon were widened by a decade.
  it("keeps the date at exactly the ten-year horizon", () => {
    const est = shippingEstimate([day("2026-07-23", 3651, 4000), day("2026-07-24", 3650, 4000)]);
    expect(est.daysLeft).toBe(3650);
    expect(est.date).not.toBeNull();
  });

  it("drops the date one day past the horizon", () => {
    const est = shippingEstimate([day("2026-07-23", 3652, 4000), day("2026-07-24", 3651, 4000)]);
    expect(est.daysLeft).toBe(3651);
    expect(est.date).toBeNull();
  });

  // The window is an index offset into the snapshots, not a calendar lookback.
  // With dense daily data the two coincide; with a skipped day they do not, and
  // spanDays reports the real elapsed time. This test documents that behaviour so
  // a future change to date-based windowing is a deliberate decision.
  describe("rate window", () => {
    const dense = Array.from({ length: 9 }, (_, i) =>
      day(iso(addDays(parseDay("2026-07-01"), i)), 1000 - i * 10, 1200 - i * 10)
    );

    it("spans exactly RATE_WINDOW_DAYS days when no snapshot is missing", () => {
      expect(shippingEstimate(dense).spanDays).toBe(RATE_WINDOW_DAYS);
    });

    it("spans more calendar days than its name suggests when days were skipped", () => {
      // Same nine snapshots, but the last five sit five days later: the window
      // still covers seven *snapshots*, now stretched over twelve days.
      const gapped = dense.map((entry, i) =>
        i < 4 ? entry : { ...entry, date: iso(addDays(parseDay(entry.date), 5)) }
      );
      const est = shippingEstimate(gapped);
      expect(est.spanDays).toBe(RATE_WINDOW_DAYS + 5);

      // Not 70/12: that is the endpoint average, and this series is not linear
      // in time — it gains ten places between consecutive snapshots whether they
      // are a day or six days apart. The fit sees the two dense clusters and
      // reads the flat stretch between them as the slowdown it is, so it lands
      // below the endpoint figure rather than pretending the gap was productive.
      expect(est.rate).toBeCloseTo(4.8513, 4);
      expect(est.rate).toBeLessThan(70 / 12);
    });
  });

  describe("rate fitting", () => {
    it("ignores a spike at one end that the endpoint difference would follow", () => {
      // Six days of a steady 10 places/day, then one bad relevé. Measuring from
      // the endpoints alone reads 10 → (60-50)/6 ≈ 1.7 places/day and pushes the
      // date out by years; the fit barely moves.
      const steady = Array.from({ length: 7 }, (_, i) =>
        day(iso(addDays(parseDay("2026-07-01"), i)), 100 - i * 10, 300 - i * 10)
      );
      const spiked = steady.with(6, day("2026-07-07", 50, 240));

      expect(shippingEstimate(steady).rate).toBeCloseTo(10, 10);
      expect(shippingEstimate(spiked).rate).toBeGreaterThan(7);
    });

    it("reports a range around the fit once a residual can be measured", () => {
      const noisy = [
        day("2026-07-01", 100, 300),
        day("2026-07-02", 95, 295),
        day("2026-07-03", 78, 278),
        day("2026-07-04", 74, 274),
      ];
      const est = shippingEstimate(noisy);
      // Bracketing, and the right way round: a faster queue ships sooner.
      expect(est.range.earliest.getTime()).toBeLessThan(est.date.getTime());
      expect(est.range.latest.getTime()).toBeGreaterThan(est.date.getTime());
    });

    it("offers no range on two snapshots, where the fit is exact by construction", () => {
      // Zero residual is not zero uncertainty: with one degree of freedom used
      // up per parameter there is nothing left to measure the spread with.
      expect(shippingEstimate([day("2026-07-01", 100, 300), day("2026-07-02", 90, 290)]).range)
        .toBeNull();
    });

    it("offers no range on a perfectly straight series", () => {
      const straight = Array.from({ length: 5 }, (_, i) =>
        day(iso(addDays(parseDay("2026-07-01"), i)), 100 - i * 10, 300 - i * 10)
      );
      expect(shippingEstimate(straight).range).toBeNull();
    });

    it("drops the late bound when the slow end of the range allows a standstill", () => {
      // A queue that barely moves while our rank wobbles a few places either
      // way. The fit still slopes down, but the spread around it covers a
      // stalled queue, and the late bound would be "never" rather than a date.
      const erratic = [
        day("2026-07-01", 500, 700),
        day("2026-07-02", 505, 705),
        day("2026-07-03", 498, 698),
        day("2026-07-04", 503, 703),
        day("2026-07-05", 497, 697),
      ];
      const est = shippingEstimate(erratic);
      expect(est.rate).toBeGreaterThan(0);
      expect(est.range.latest).toBeNull();
      expect(est.range.earliest).not.toBeNull();
    });
  });
});

describe("historicalRate", () => {
  // history.length - 1 snapshots after the first, so the rolling window in
  // shippingEstimate (RATE_WINDOW_DAYS + 1 snapshots at most) already covers
  // everything at this size — one more entry than that is the smallest history
  // where a whole-series fit differs from the rolling one at all.
  const dense = (n) =>
    Array.from({ length: n }, (_, i) =>
      day(iso(addDays(parseDay("2026-07-01"), i)), 1000 - i * 10, 1200 - i * 10)
    );

  it("has nothing to compare while the rolling window still covers the whole series", () => {
    expect(historicalRate(dense(RATE_WINDOW_DAYS + 1))).toBeNull();
  });

  it("fits once the series outgrows the rolling window", () => {
    expect(historicalRate(dense(RATE_WINDOW_DAYS + 2))).not.toBeNull();
  });

  it("differs from the rolling rate when the pace itself has changed", () => {
    // Four days fast (-10/day), then eight slower (-2/day). The rolling window
    // (the last RATE_WINDOW_DAYS + 1 = 8 snapshots) sits entirely in the slow
    // half; the whole-series fit sees both and lands in between.
    const history = [
      ...Array.from({ length: 4 }, (_, i) =>
        day(iso(addDays(parseDay("2026-07-01"), i)), 1000 - i * 10, 1200)
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        day(iso(addDays(parseDay("2026-07-01"), i + 4)), 960 - i * 2, 1200)
      ),
    ];

    const recent = shippingEstimate(history);
    expect(recent.rate).toBe(2);
    expect(recent.spanDays).toBe(RATE_WINDOW_DAYS);

    const overall = historicalRate(history);
    expect(overall.rate).toBeCloseTo(4.5175, 4);
    expect(overall.spanDays).toBe(11);
    expect(overall.rate).toBeGreaterThan(recent.rate);
  });
});
