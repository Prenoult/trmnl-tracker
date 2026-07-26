// Chart geometry. The failure this suite exists for: a NaN reaching an SVG path's
// `d` attribute makes the curve disappear with no error in the console, on a page
// nobody is watching.

import { describe, it, expect } from "vitest";

import { CHART, buildChartModel, niceTicks } from "../lib/chart-model.js";
import { addDays, parseDay } from "../lib/domain.js";

const day = (date, position, total) => ({ date, position, total });
const iso = (d) => d.toISOString().slice(0, 10);

// The real snapshots in the repository: +30, +71, then +1 — the unevenness the
// gains strip exists to show.
const real = [
  day("2026-07-23", 1417, 1523),
  day("2026-07-24", 1387, 1503),
  day("2026-07-25", 1316, 1438),
  day("2026-07-26", 1315, 1481),
];

const series = (count, { from = "2026-07-01", step = 1, start = 1000, gain = 10 } = {}) =>
  Array.from({ length: count }, (_, i) =>
    day(iso(addDays(parseDay(from), i * step)), start - i * gain, start + 200 - i * gain)
  );

// Every number the model exposes, flattened with a path so a failure names the
// field. Dates are checked through getTime(); functions are skipped.
function numbers(value, path = "model", out = []) {
  if (typeof value === "number") out.push([path, value]);
  else if (value instanceof Date) out.push([`${path}.getTime()`, value.getTime()]);
  else if (Array.isArray(value)) value.forEach((v, i) => numbers(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) numbers(v, `${path}.${k}`, out);
  }
  return out;
}

const nonFinite = (model) => numbers(model).filter(([, v]) => !Number.isFinite(v));

describe("niceTicks", () => {
  it("does not collapse a flat series to one tick", () => {
    const ticks = niceTicks(100, 100);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeLessThan(100);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(100);
  });

  it("snaps to round numbers", () => {
    expect(niceTicks(0, 1417)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(1316, 1417)).toEqual([1300, 1350, 1400, 1450]);
  });

  it.each([
    [0, 1417],
    [1316, 1417],
    [100, 100],
    [1, 3],
    [0, 7],
    [990, 1000],
    [0, 1_000_000],
  ])("brackets the data and stays on whole ranks for (%i, %i)", (min, max) => {
    const ticks = niceTicks(min, max);
    // Rounding outwards: a domain stopping short of the extremes would clip the line.
    expect(ticks[0]).toBeLessThanOrEqual(min);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    // Positions count whole orders, so no tick may be labelled 2.5.
    expect(ticks.every(Number.isInteger)).toBe(true);
    expect(ticks.every((v, i) => i === 0 || v > ticks[i - 1])).toBe(true);
  });
});

describe("buildChartModel", () => {
  it("has nothing to draw with fewer than two snapshots", () => {
    expect(buildChartModel([])).toBeNull();
    expect(buildChartModel([real[0]])).toBeNull();
  });

  it("maps one point per snapshot, carrying the source values", () => {
    const model = buildChartModel(real);
    expect(model.points).toHaveLength(4);
    expect(model.points.map((p) => p.position)).toEqual([1417, 1387, 1316, 1315]);
    expect(model.points.map((p) => p.total)).toEqual([1523, 1503, 1438, 1481]);
  });

  it("draws progress as a descending line, matching the caption", () => {
    const model = buildChartModel(real);
    // The axis runs from the largest rank at the top down to the lowest tick at
    // the baseline, so gaining places moves the line *down*: "plus bas = plus
    // proche de l'expédition".
    expect(model.points[model.points.length - 1].y).toBeGreaterThan(model.points[0].y);
    expect(model.y(model.lo)).toBeGreaterThan(model.y(model.hi));
    expect(model.y(model.lo)).toBeCloseTo(model.baselineY, 6);
  });

  it("keeps the curve inside the plot area", () => {
    const model = buildChartModel(real);
    for (const p of model.points) {
      expect(p.y).toBeGreaterThanOrEqual(CHART.top);
      expect(p.y).toBeLessThanOrEqual(model.baselineY);
      expect(p.x).toBeGreaterThanOrEqual(CHART.left);
      expect(p.x).toBeLessThanOrEqual(CHART.w - CHART.right);
    }
  });

  describe("no NaN or Infinity anywhere in the model", () => {
    const cases = {
      "the real series": real,
      "two snapshots": real.slice(0, 2),
      "a flat series": [day("2026-07-01", 500, 900), day("2026-07-02", 500, 900)],
      "a series moving backwards": [day("2026-07-01", 500, 900), day("2026-07-02", 520, 940)],
      "a one-place queue": [day("2026-07-01", 1, 1), day("2026-07-02", 1, 1)],
      "a huge queue": [day("2026-07-01", 999_999, 1_000_000), day("2026-07-02", 999_998, 999_999)],
      "an almost-shipped order": [day("2026-07-01", 3, 40), day("2026-07-02", 1, 30)],
      "a long dense series": series(60),
      "a series with gaps": series(9, { step: 3 }),
      "duplicate positions": series(5, { gain: 0 }),
    };

    for (const [name, history] of Object.entries(cases)) {
      it(name, () => {
        const model = buildChartModel(history);
        expect(nonFinite(model)).toEqual([]);
      });
    }
  });

  describe("projection", () => {
    // Close enough to the front of the queue that the forecast fits: two days of
    // history, 20 places left at 40/day, so the target lands one day out.
    const nearlyThere = [day("2026-07-01", 100, 200), day("2026-07-03", 20, 120)];

    it("runs to position zero and extends the axis there when it fits", () => {
      const model = buildChartModel(nearlyThere);
      expect(iso(model.projection.date)).toBe("2026-07-04");
      expect(model.projection.clipped).toBe(false);
      expect(model.lo).toBe(0);
      expect(model.projection.y).toBe(model.y(0));
      // The forecast sits to the right of the last real snapshot.
      expect(model.projection.x).toBeGreaterThan(model.points[1].x);
    });

    it("never squeezes the data below its share of the width", () => {
      // The case this floor exists for: three relevés and a month-long forecast
      // used to leave the real curve 7% of the plot.
      const model = buildChartModel(real);
      const drawn = model.points[model.points.length - 1].x - model.points[0].x;
      expect(drawn / model.geom.plotW).toBeCloseTo(0.55, 6);
    });

    it("clips at the right edge, keeping the real target date for the caption", () => {
      const model = buildChartModel(real);
      // The fit reads 37.7 places/day, so 1315 places ≈ 35 days — far past the edge.
      expect(model.projection.clipped).toBe(true);
      expect(iso(model.projection.target)).toBe("2026-08-30");
      expect(iso(model.projection.date)).not.toBe("2026-08-30");
      expect(model.projection.x).toBeCloseTo(CHART.w - CHART.right, 6);
    });

    it("scales the axis to the clipped forecast, not down to an off-screen zero", () => {
      const model = buildChartModel(real);
      // Reaching for 0 would spend most of the height on ranks never drawn.
      expect(model.lo).toBeGreaterThan(1000);
      expect(model.projection.y).toBeGreaterThan(model.points[model.points.length - 1].y);
      expect(model.projection.y).toBeLessThanOrEqual(model.baselineY);
    });

    it("is absent when the queue is not moving, and the axis stays on the data", () => {
      const model = buildChartModel([
        day("2026-07-01", 500, 900),
        day("2026-07-02", 500, 900),
      ]);
      expect(model.projection).toBeNull();
      expect(model.lo).toBeGreaterThan(0);
    });

    it("is absent when the horizon is beyond ten years", () => {
      const model = buildChartModel([
        day("2026-07-01", 1_000_000, 1_000_000),
        day("2026-07-02", 999_999, 999_999),
      ]);
      expect(model.projection).toBeNull();
    });
  });

  describe("queue size, the second series", () => {
    it("shares the position's axis, so the gap between the lines means something", () => {
      const model = buildChartModel(real);
      // Both are orders on one scale: the vertical distance between the two
      // lines is the orders sitting behind us, which is the reason to draw it.
      expect(model.totalPoints.map((p) => p.total)).toEqual([1523, 1503, 1438, 1481]);
      expect(model.totalPoints[0].y).toBe(model.y(1523));
      expect(model.totalPoints.map((p) => p.x)).toEqual(model.points.map((p) => p.x));
    });

    it("raises the axis to hold the queue, which is always above the rank", () => {
      const model = buildChartModel(real);
      expect(model.hi).toBeGreaterThanOrEqual(1523);
      for (const p of model.totalPoints) {
        expect(p.y).toBeGreaterThanOrEqual(CHART.top);
        expect(p.y).toBeLessThanOrEqual(model.baselineY);
      }
    });

    it("draws the queue above the position, since a rank cannot exceed its queue", () => {
      const model = buildChartModel(real);
      model.totalPoints.forEach((p, i) => expect(p.y).toBeLessThan(model.points[i].y));
    });
  });

  describe("the gains strip", () => {
    it("draws one column per movement, not per snapshot", () => {
      const { bars } = buildChartModel(real);
      expect(bars.columns).toHaveLength(3);
      expect(bars.columns.map((c) => c.gained)).toEqual([30, 71, 1]);
    });

    it("puts each column on the curve's x, so both panels share one time axis", () => {
      const model = buildChartModel(real);
      model.bars.columns.forEach((c, i) => expect(c.x).toBe(model.points[i + 1].x));
    });

    it("scales to the best movement", () => {
      const { bars } = buildChartModel(real);
      expect(bars.max).toBe(71);
      const best = bars.columns.find((c) => c.gained === 71);
      expect(best.height).toBeCloseTo(bars.geom.plotH, 6);
      expect(best.y).toBeCloseTo(bars.geom.top, 6);
    });

    // Same rule as the axis rounding and for the same reason: 1 place out of 71
    // is half a pixel, and erasing it hides the unevenness the strip exists for.
    it("keeps a visible column for a movement of one place", () => {
      const { bars } = buildChartModel(real);
      expect(bars.columns.find((c) => c.gained === 1).height).toBeGreaterThanOrEqual(1.5);
    });

    it("gives a standstill no column at all", () => {
      const { bars } = buildChartModel([
        day("2026-07-01", 500, 900),
        day("2026-07-02", 500, 880),
      ]);
      expect(bars.columns[0].height).toBe(0);
    });

    it("hangs a loss below the baseline", () => {
      const { bars } = buildChartModel([
        day("2026-07-01", 100, 200),
        day("2026-07-02", 90, 190),
        day("2026-07-03", 110, 215),
      ]);
      const loss = bars.columns.find((c) => c.gained === -20);
      expect(loss.gained).toBe(-20);
      expect(loss.y).toBeCloseTo(bars.baselineY, 6);
      expect(loss.y + loss.height).toBeGreaterThan(bars.baselineY);
      // And the winning column still hangs off the same baseline, upwards.
      const gain = bars.columns.find((c) => c.gained === 10);
      expect(gain.y).toBeLessThan(bars.baselineY);
    });

    it("keeps every column inside the strip", () => {
      for (const history of [real, series(60), series(9, { step: 3 })]) {
        const { bars } = buildChartModel(history);
        for (const c of bars.columns) {
          expect(c.y).toBeGreaterThanOrEqual(bars.geom.top - 0.001);
          expect(c.y + c.height).toBeLessThanOrEqual(bars.geom.top + bars.geom.plotH + 0.001);
        }
      }
    });

    it("narrows the columns rather than overlapping them on a long history", () => {
      const short = buildChartModel(series(4)).bars;
      const long = buildChartModel(series(60)).bars;
      expect(long.width).toBeLessThan(short.width);
      expect(long.width).toBeGreaterThan(0);
      // Sized off the tightest gap, so the closest pair still clears.
      const gaps = long.columns.slice(1).map((c, i) => c.x - long.columns[i].x);
      expect(long.width).toBeLessThanOrEqual(Math.min(...gaps));
    });

    it("sizes off the tightest gap when the workflow skipped days", () => {
      // Two relevés a day apart, then one four days later: the wide gap must not
      // set the width, or the close pair overlaps.
      const { bars } = buildChartModel([
        day("2026-07-01", 100, 200),
        day("2026-07-02", 90, 190),
        day("2026-07-06", 50, 150),
      ]);
      const tightest = bars.columns[1].x - bars.columns[0].x;
      expect(bars.width).toBeLessThanOrEqual(tightest);
    });
  });

  describe("x axis", () => {
    it("spans real time, so a skipped day leaves a wider gap", () => {
      // Three snapshots, the last one three days after the second.
      const model = buildChartModel([
        day("2026-07-01", 100, 200),
        day("2026-07-02", 90, 190),
        day("2026-07-05", 60, 160),
      ]);
      const [a, b, c] = model.points;
      expect(c.x - b.x).toBeCloseTo(3 * (b.x - a.x), 6);
    });

    it("keeps equal spacing when every day is present", () => {
      const model = buildChartModel(series(5));
      const gaps = model.points.slice(1).map((p, i) => p.x - model.points[i].x);
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    });
  });

  describe("end label", () => {
    it("flips to the left when the last point sits in the right of the plot", () => {
      // No projection, so the last snapshot lands on the right edge.
      const model = buildChartModel([day("2026-07-01", 500, 900), day("2026-07-02", 500, 900)]);
      expect(model.end.labelLeft).toBe(true);
      expect(model.end.labelX).toBeLessThan(model.end.x);
    });

    it("stays on the right when a distant projection pushes the point left", () => {
      const model = buildChartModel(real);
      expect(model.end.labelLeft).toBe(false);
      expect(model.end.labelX).toBeGreaterThan(model.end.x);
    });

    it("never rides up out of the plot area", () => {
      // An order at position 1 sits on the top gridline, where the label would
      // otherwise be placed above the chart.
      const model = buildChartModel([day("2026-07-01", 3, 40), day("2026-07-02", 1, 30)]);
      expect(model.end.labelY).toBeGreaterThanOrEqual(CHART.top);
    });
  });

  describe("date labels", () => {
    it("labels both ends and the last snapshot when it sits clear of them", () => {
      // A one-day projection leaves the last snapshot around two thirds across.
      const model = buildChartModel([day("2026-07-01", 100, 200), day("2026-07-03", 20, 120)]);
      expect(model.dateMarks.map((m) => m.anchor)).toEqual(["start", "middle", "end"]);
    });

    it("drops the middle label when the last snapshot would collide with an end", () => {
      // A projection that fits pushes the last snapshot hard left; with the
      // width floor in place it takes a long series to get there.
      const model = buildChartModel([...series(30), day("2026-08-01", 5, 400)]);
      expect(model.dateMarks.map((m) => m.anchor)).toEqual(["start", "end"]);
    });

    it("labels the clipped edge with the date the axis actually stops at", () => {
      const model = buildChartModel(real);
      const end = model.dateMarks[model.dateMarks.length - 1];
      expect(end.anchor).toBe("end");
      expect(end.date.getTime()).toBe(model.projection.date.getTime());
      // Not the shipping estimate: that one is off the chart.
      expect(end.date.getTime()).toBeLessThan(model.projection.target.getTime());
    });

    it("anchors the last snapshot at the right edge when there is no projection", () => {
      const model = buildChartModel([day("2026-07-01", 500, 900), day("2026-07-02", 500, 900)]);
      expect(model.dateMarks).toHaveLength(2);
      expect(iso(model.dateMarks[1].date)).toBe("2026-07-02");
    });
  });

  describe("dots", () => {
    it("draws one per snapshot up to twenty", () => {
      expect(buildChartModel(series(20)).showDots).toBe(true);
    });

    it("stops past twenty, where they turn the line into a bead string", () => {
      expect(buildChartModel(series(21)).showDots).toBe(false);
    });
  });
});
