// The cadence card. Its whole reason for existing is that the position curve
// smooths the thing that matters — a day that gained one place and a day that
// gained seventy read as much the same slope — so the numbers behind the meters
// are the part worth testing.

import { describe, it, expect } from "vitest";

import { RATE_WINDOW_DAYS } from "../lib/config.js";
import { addDays, parseDay } from "../lib/domain.js";
import { METER_TICKS, buildFlowModel, ticksFor } from "../lib/flow-model.js";

const day = (date, position, total) => ({ date, position, total });
const iso = (d) => d.toISOString().slice(0, 10);

// The four real snapshots in the repository: +30, +71, then +1.
const real = [
  day("2026-07-23", 1417, 1523),
  day("2026-07-24", 1387, 1503),
  day("2026-07-25", 1316, 1438),
  day("2026-07-26", 1315, 1481),
];

describe("ticksFor", () => {
  it("fills the whole track at the maximum", () => {
    expect(ticksFor(50, 50)).toBe(METER_TICKS);
  });

  it("is proportional in between", () => {
    expect(ticksFor(25, 50)).toBe(METER_TICKS / 2);
  });

  // The +1 day against a +71 day rounds to 0.56 of a tick. An empty track would
  // say "nothing happened", which is not what one place gained means.
  it("never rounds a real value down to an empty track", () => {
    expect(ticksFor(1, 71)).toBe(1);
    expect(ticksFor(0.0001, 1_000_000)).toBe(1);
  });

  it("leaves the track empty for nothing and for a loss", () => {
    expect(ticksFor(0, 50)).toBe(0);
    expect(ticksFor(-10, 50)).toBe(0);
  });

  it("stays inside the track when the value exceeds the scale", () => {
    expect(ticksFor(80, 50)).toBe(METER_TICKS);
  });

  it("returns an empty track rather than NaN when there is no scale", () => {
    expect(ticksFor(5, 0)).toBe(0);
    expect(ticksFor(5, -3)).toBe(0);
  });
});

describe("buildFlowModel", () => {
  it("has nothing to show before the second snapshot", () => {
    expect(buildFlowModel([])).toBeNull();
    expect(buildFlowModel([real[0]])).toBeNull();
  });

  it("splits the movement into orders gone ahead and orders joined behind", () => {
    const { flow } = buildFlowModel(real);
    // 102 places gained; the queue shrank by 42, so 60 orders did join.
    expect(flow.map((f) => [f.key, f.value])).toEqual([
      ["shipped", 102],
      ["joined", 60],
    ]);
  });

  it("puts the two on one scale, so the comparison is the meter", () => {
    const [shipped, joined] = buildFlowModel(real).flow;
    expect(shipped.ticks).toBe(METER_TICKS);
    expect(joined.ticks).toBe(ticksFor(60, 102));
    expect(joined.ticks).toBeLessThan(shipped.ticks);
  });

  it("reports the real elapsed span of the window", () => {
    expect(buildFlowModel(real).spanDays).toBe(3);
  });

  it("lists one row per movement, newest first", () => {
    const { daily } = buildFlowModel(real);
    expect(daily.map((d) => d.date)).toEqual(["2026-07-26", "2026-07-25", "2026-07-24"]);
    expect(daily.map((d) => d.value)).toEqual([1, 71, 30]);
  });

  it("scales the daily rows to the best day, not to the flow totals", () => {
    const { daily } = buildFlowModel(real);
    const best = daily.find((d) => d.value === 71);
    expect(best.ticks).toBe(METER_TICKS);
    expect(daily.find((d) => d.value === 1).ticks).toBe(1);
  });

  it("carries the day count so a skipped relevé cannot pass for one good day", () => {
    const gapped = [day("2026-07-01", 100, 200), day("2026-07-05", 60, 160)];
    const [row] = buildFlowModel(gapped).daily;
    expect(row.days).toBe(4);
    expect(row.value).toBe(40);
  });

  describe("the window", () => {
    const dense = Array.from({ length: 12 }, (_, i) =>
      day(iso(addDays(parseDay("2026-07-01"), i)), 1000 - i * 10, 1200 - i * 10)
    );

    // Same window the shipping estimate fits its rate over, so the card reads as
    // the evidence for that estimate rather than a differently scoped opinion.
    it("covers the same snapshots as the rate window", () => {
      const model = buildFlowModel(dense);
      expect(model.daily).toHaveLength(RATE_WINDOW_DAYS);
      expect(model.spanDays).toBe(RATE_WINDOW_DAYS);
    });

    it("uses everything there is when the history is shorter", () => {
      expect(buildFlowModel(real).daily).toHaveLength(3);
    });
  });

  describe("a queue moving backwards", () => {
    const slipped = [
      day("2026-07-01", 100, 200),
      day("2026-07-02", 110, 220),
      day("2026-07-03", 105, 214),
    ];

    it("keeps the negative value and empties its track", () => {
      const { daily } = buildFlowModel(slipped);
      const loss = daily.find((d) => d.date === "2026-07-02");
      expect(loss.value).toBe(-10);
      expect(loss.ticks).toBe(0);
    });

    it("produces no NaN when every movement is a loss", () => {
      const allLoss = [
        day("2026-07-01", 100, 200),
        day("2026-07-02", 110, 210),
        day("2026-07-03", 120, 220),
      ];
      const model = buildFlowModel(allLoss);
      const numbers = [
        model.spanDays,
        ...model.flow.flatMap((f) => [f.value, f.ticks]),
        ...model.daily.flatMap((d) => [d.value, d.ticks, d.days]),
      ];
      expect(numbers.every(Number.isFinite)).toBe(true);
      expect(model.daily.every((d) => d.ticks === 0)).toBe(true);
    });
  });
});
