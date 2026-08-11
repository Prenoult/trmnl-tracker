// The queue lane. Same failure this suite exists for as the chart's: a NaN in an
// SVG attribute draws nothing and says nothing, on a page nobody is watching.
// The lane has a second one of its own — the marker is the whole point of the
// drawing, and a marker that lands outside the lane, or on the wrong side of the
// ticks, is a picture that lies about where the order sits.

import { describe, it, expect } from "vitest";

import { QUEUE, buildQueueModel } from "../lib/queue-model.js";

const day = (date, position, total) => ({ date, position, total });

// The current snapshot in the repository.
const latest = day("2026-08-11", 1114, 1611);
const first = day("2026-07-23", 1417, 1523);

function numbers(value, path = "model", out = []) {
  if (typeof value === "number") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numbers(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) numbers(v, `${path}.${k}`, out);
  }
  return out;
}

const nonFinite = (model) => numbers(model).filter(([, v]) => !Number.isFinite(v));
const laneRight = QUEUE.w - QUEUE.right;

describe("buildQueueModel", () => {
  it("has nothing to draw without a snapshot, or without a queue to draw", () => {
    expect(buildQueueModel(null)).toBeNull();
    expect(buildQueueModel(day("2026-08-11", 0, 0))).toBeNull();
    expect(buildQueueModel(day("2026-08-11", 5, -3))).toBeNull();
  });

  describe("the two counts, which are what the figures print", () => {
    it("splits the queue around the order itself", () => {
      const model = buildQueueModel(latest);
      expect(model.ahead).toBe(1113);
      expect(model.behind).toBe(497);
      // Everyone but the order itself is on one side or the other.
      expect(model.ahead + model.behind).toBe(model.total - 1);
    });

    it("leaves nobody ahead of the order at the front", () => {
      const model = buildQueueModel(day("2026-08-11", 1, 900));
      expect(model.ahead).toBe(0);
      expect(model.behind).toBe(899);
    });

    it("leaves nobody behind the order at the back", () => {
      const model = buildQueueModel(day("2026-08-11", 900, 900));
      expect(model.ahead).toBe(899);
      expect(model.behind).toBe(0);
    });
  });

  describe("the marker", () => {
    it("sits inside the lane, at its share of it", () => {
      const model = buildQueueModel(latest);
      expect(model.marker.x).toBeGreaterThan(QUEUE.left);
      expect(model.marker.x).toBeLessThan(laneRight);
      // 1114 of 1611 is a shade over two thirds along.
      expect((model.marker.x - QUEUE.left) / model.geom.laneW).toBeCloseTo(0.691, 2);
    });

    // Ranks are slices of the lane, not points on its edge: rank 1 is the first
    // slice of the queue, and drawing it at x = left would hang half a tick off
    // the end of the comb.
    it.each([
      ["the front", day("2026-08-11", 1, 900)],
      ["the back", day("2026-08-11", 900, 900)],
      ["a queue of one", day("2026-08-11", 1, 1)],
    ])("stays inside the lane at %s", (_name, snapshot) => {
      const model = buildQueueModel(snapshot);
      expect(model.marker.x).toBeGreaterThanOrEqual(QUEUE.left);
      expect(model.marker.x).toBeLessThanOrEqual(laneRight);
    });

    it("keeps the chip inside the card, tip attached, wherever the marker is", () => {
      for (const snapshot of [day("d", 1, 900), day("d", 900, 900), latest]) {
        const { marker } = buildQueueModel(snapshot);
        expect(marker.chipX).toBeGreaterThanOrEqual(QUEUE.left);
        expect(marker.chipX + marker.chipW).toBeLessThanOrEqual(laneRight);
        // Wherever the box ends up, the tip stays on it rather than tearing off
        // towards a marker the box could not follow to the edge of the lane.
        expect(marker.chipTipX).toBeGreaterThan(marker.chipX);
        expect(marker.chipTipX).toBeLessThan(marker.chipX + marker.chipW);
      }
    });

    it("points the chip straight at the marker everywhere but the two ends", () => {
      expect(buildQueueModel(latest).marker.chipTipX).toBe(buildQueueModel(latest).marker.x);
    });
  });

  describe("the comb", () => {
    it("tiles the lane without overlapping, at any queue size", () => {
      for (const total of [1, 5, 91, 92, 1611, 100_000]) {
        const { ticks, geom } = buildQueueModel(day("d", 1, total));
        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks[0].x).toBeGreaterThanOrEqual(QUEUE.left);
        for (const [i, t] of ticks.entries()) {
          expect(t.width).toBeGreaterThan(0);
          if (i > 0) expect(t.x).toBeGreaterThanOrEqual(ticks[i - 1].x + ticks[i - 1].width);
        }
        const last = ticks[ticks.length - 1];
        expect(last.x + last.width).toBeLessThanOrEqual(QUEUE.left + geom.laneW + 0.001);
      }
    });

    // A texture of ninety ticks over five orders would claim a precision the
    // queue does not have: one tick is never less than one order.
    it("never draws more ticks than there are orders", () => {
      expect(buildQueueModel(day("d", 3, 5)).ticks).toHaveLength(5);
      expect(buildQueueModel(day("d", 1, 1)).ticks).toHaveLength(1);
      expect(buildQueueModel(day("d", 1, 5)).perTick).toBe(1);
    });

    it("says what one tick is worth on a real queue", () => {
      const model = buildQueueModel(latest);
      expect(model.perTick).toBeGreaterThan(1);
      expect(model.perTick * model.ticks.length).toBeCloseTo(model.total, 6);
    });

    it("splits at the marker: everything ahead is on its left", () => {
      const { ticks, marker } = buildQueueModel(latest);
      const ahead = ticks.filter((t) => t.ahead);
      const behind = ticks.filter((t) => !t.ahead);
      expect(ahead.length).toBeGreaterThan(0);
      expect(behind.length).toBeGreaterThan(0);
      for (const t of ahead) expect(t.x).toBeLessThan(marker.x);
      for (const t of behind) expect(t.x + t.width).toBeGreaterThan(marker.x);
      // Contiguous: the queue ahead is a prefix of the lane, never a dotted set.
      expect(ticks.findIndex((t) => !t.ahead)).toBe(ahead.length);
    });

    it("leaves nothing lit for an order at the front of the queue", () => {
      expect(buildQueueModel(day("d", 1, 900)).ticks.some((t) => t.ahead)).toBe(false);
    });
  });

  describe("the travel trail", () => {
    it("runs from the oldest rank to the current one, pointing forwards", () => {
      const model = buildQueueModel(latest, first);
      expect(model.start.position).toBe(1417);
      expect(model.start.clamped).toBe(false);
      expect(model.trail.gained).toBe(303);
      // Gaining places moves towards the front, which is the left of the lane.
      expect(model.trail.direction).toBe(-1);
      expect(model.trail.from).toBe(model.marker.x);
      expect(model.trail.to).toBe(model.start.x);
    });

    it("turns around when the order lost ground", () => {
      const model = buildQueueModel(day("d", 700, 900), day("d", 500, 900));
      expect(model.trail.gained).toBe(-200);
      expect(model.trail.direction).toBe(1);
      expect(model.trail.from).toBe(model.start.x);
      expect(model.trail.to).toBe(model.marker.x);
    });

    it("has nothing to draw on a first relevé", () => {
      const model = buildQueueModel(latest);
      expect(model.start).toBeNull();
      expect(model.trail).toBeNull();
      // And the card gets shorter rather than carrying an empty band.
      expect(model.geom.h).toBe(QUEUE.hBare);
      expect(buildQueueModel(latest, first).geom.h).toBe(QUEUE.h);
    });

    // A ghost a pixel from the marker is a smudge, not a second reading.
    it("drops the ghost with the trail when the two would overlap", () => {
      const model = buildQueueModel(latest, day("d", 1112, 1523));
      expect(model.trail).toBeNull();
      expect(model.start).toBeNull();
    });

    it("puts a rank the queue has since outgrown at the back of the lane", () => {
      // The queue shed orders from behind: the starting rank no longer fits in it.
      const model = buildQueueModel(day("d", 400, 600), day("d", 900, 1200));
      expect(model.start.clamped).toBe(true);
      expect(model.start.x).toBeLessThanOrEqual(laneRight);
      expect(model.start.x).toBeGreaterThan(model.marker.x);
      // The figure it reports is still the real one, not the clamped rank.
      expect(model.trail.gained).toBe(500);
    });

    it("keeps its label inside the card wherever the trail sits", () => {
      for (const [now, then] of [
        [day("d", 5, 900), day("d", 890, 900)],
        [day("d", 890, 900), day("d", 5, 900)],
        [day("d", 860, 900), day("d", 895, 900)],
      ]) {
        const { trail } = buildQueueModel(now, then);
        expect(trail.labelX).toBeGreaterThanOrEqual(QUEUE.left);
        expect(trail.labelX).toBeLessThanOrEqual(laneRight);
      }
    });
  });

  describe("no NaN or Infinity anywhere in the model", () => {
    const cases = {
      "the real snapshot": [latest, first],
      "a first relevé": [latest, null],
      "the front of the queue": [day("d", 1, 900), day("d", 900, 1000)],
      "the back of the queue": [day("d", 900, 900), day("d", 400, 500)],
      "a queue of one": [day("d", 1, 1), day("d", 40, 60)],
      "a huge queue": [day("d", 999_999, 1_000_000), day("d", 1_000_000, 1_000_000)],
      "an order that has not moved": [latest, latest],
      "an order that lost ground": [day("d", 700, 900), day("d", 500, 800)],
      "a rank the queue has outgrown": [day("d", 400, 600), day("d", 5000, 6000)],
    };

    for (const [name, [now, then]] of Object.entries(cases)) {
      it(name, () => {
        expect(nonFinite(buildQueueModel(now, then))).toEqual([]);
      });
    }
  });
});
