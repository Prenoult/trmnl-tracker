// The write path. A bad write here is committed and pushed by the daily workflow
// before anyone can see it, which makes these the highest-stakes tests in the
// suite even though the functions are tiny.

import { describe, it, expect } from "vitest";

import { parseHistory, staleness, upsertSnapshot, validateSnapshot } from "../lib/history.js";

const day = (date, position, total) => ({ date, position, total });
const real = [day("2026-07-23", 1417, 1523), day("2026-07-24", 1387, 1503)];

describe("parseHistory", () => {
  it("accepts a well-formed history", () => {
    expect(parseHistory(JSON.stringify(real))).toEqual(real);
  });

  it("accepts an empty array", () => {
    expect(parseHistory("[]")).toEqual([]);
  });

  // The whole point of the function. Returning [] here is what used to destroy the
  // series: the caller would append today and write a one-entry file over it.
  it("throws on malformed JSON rather than reporting an empty history", () => {
    expect(() => parseHistory('[{"date":"2026-07-23","position":1417,')).toThrow(/not valid JSON/);
  });

  it("throws when the file is not an array", () => {
    expect(() => parseHistory('{"date":"2026-07-23"}')).toThrow(/must be an array/);
    expect(() => parseHistory("null")).toThrow(/must be an array/);
    expect(() => parseHistory('"1417"')).toThrow(/must be an array/);
  });

  it("throws on an entry with a malformed date", () => {
    expect(() => parseHistory('[{"date":"25/07/2026","position":1,"total":2}]')).toThrow(
      /history\[0\]: bad date/
    );
    expect(() => parseHistory('[{"position":1,"total":2}]')).toThrow(/bad date/);
  });

  it("throws on non-integer or non-positive counts", () => {
    expect(() => parseHistory('[{"date":"2026-07-23","position":0,"total":2}]')).toThrow(
      /position must be a positive integer/
    );
    expect(() => parseHistory('[{"date":"2026-07-23","position":1.5,"total":2}]')).toThrow(
      /position must be a positive integer/
    );
    expect(() => parseHistory('[{"date":"2026-07-23","position":1,"total":"2"}]')).toThrow(
      /total must be a positive integer/
    );
  });

  it("throws when a position sits outside its own queue", () => {
    expect(() => parseHistory('[{"date":"2026-07-23","position":90,"total":80}]')).toThrow(
      /exceeds queue size/
    );
  });

  it("names the offending index so a long file can be repaired by hand", () => {
    const broken = [...real, day("2026-07-25", 1316, 1)];
    expect(() => parseHistory(JSON.stringify(broken))).toThrow(/history\[2\]/);
  });
});

describe("validateSnapshot", () => {
  it("passes a plausible daily move", () => {
    const entry = day("2026-07-25", 1316, 1438);
    expect(validateSnapshot(entry, real[1])).toBe(entry);
  });

  it("passes with no previous snapshot on the first ever run", () => {
    const entry = day("2026-07-23", 1417, 1523);
    expect(validateSnapshot(entry, null)).toBe(entry);
  });

  it("rejects a shape the parser would also reject", () => {
    expect(() => validateSnapshot(day("2026-07-25", -1, 1438))).toThrow(/positive integer/);
    expect(() => validateSnapshot(day("2026-07-25", 1500, 1438))).toThrow(/exceeds queue size/);
  });

  // A reworded tracker page that still half-matches the regex is the realistic
  // way garbage gets in. Both bounds have to be broken to reject, so that a
  // legitimate sprint near the head of the queue still gets through.
  it("rejects an order-of-magnitude jump", () => {
    expect(() => validateSnapshot(day("2026-07-25", 1, 5), real[1])).toThrow(
      /position jumped from 1387 to 1/
    );
  });

  it("allows a big absolute move that is small relative to the queue", () => {
    // 101 places in a day is unusual but not impossible, and it is well under
    // half the queue.
    expect(() => validateSnapshot(day("2026-07-25", 1286, 1402), real[1])).not.toThrow();
  });

  it("allows a big relative move that is small in absolute terms", () => {
    // Near the head of the queue, 20 → 5 is a 75% drop and perfectly normal.
    expect(() => validateSnapshot(day("2026-07-25", 5, 25), day("2026-07-24", 20, 40))).not.toThrow();
  });

  it("rejects a move that breaks both bounds", () => {
    expect(() => validateSnapshot(day("2026-07-25", 500, 600), real[1])).toThrow(/refusing to write/);
  });

  it("notices the queue size collapsing even when our position looks sane", () => {
    expect(() => validateSnapshot(day("2026-07-25", 1380, 1400), real[1])).not.toThrow();
    expect(() => validateSnapshot(day("2026-07-25", 1380, 1_500_000), real[1])).toThrow(
      /total jumped/
    );
  });
});

describe("upsertSnapshot", () => {
  it("appends the first entry", () => {
    expect(upsertSnapshot([], real[0])).toEqual([real[0]]);
  });

  it("appends a new day", () => {
    expect(upsertSnapshot([real[0]], real[1])).toEqual(real);
  });

  it("corrects the same day in place instead of adding a second point", () => {
    const corrected = day("2026-07-24", 1380, 1500);
    const result = upsertSnapshot(real, corrected);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(corrected);
  });

  it("keeps the series in date order when a back-dated entry arrives", () => {
    const result = upsertSnapshot(real, day("2026-07-01", 1600, 1700));
    expect(result.map((h) => h.date)).toEqual(["2026-07-01", "2026-07-23", "2026-07-24"]);
  });

  it("does not mutate the history it was given", () => {
    const before = structuredClone(real);
    upsertSnapshot(real, day("2026-07-25", 1316, 1438));
    expect(real).toEqual(before);
  });
});

describe("staleness", () => {
  it("says nothing about an empty history", () => {
    expect(staleness([], "2026-07-25")).toEqual({ days: null, stale: false });
  });

  it("treats today's and yesterday's snapshot as current", () => {
    // The workflow runs at 07:00 UTC, so for most of the day the newest snapshot
    // is yesterday's. That is normal, not stale.
    expect(staleness(real, "2026-07-24")).toEqual({ days: 0, stale: false });
    expect(staleness(real, "2026-07-25")).toEqual({ days: 1, stale: false });
  });

  it("tolerates a single missed run", () => {
    expect(staleness(real, "2026-07-26")).toEqual({ days: 2, stale: false });
  });

  it("flags two missed runs", () => {
    expect(staleness(real, "2026-07-27")).toEqual({ days: 3, stale: true });
  });
});
