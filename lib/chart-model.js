// Chart geometry, separated from the SVG it feeds so the maths can be tested
// without a DOM. buildChartModel returns numbers; renderChart in app.js is a
// template over them.
//
// The failure mode this split guards against: a single NaN in a path's `d`
// attribute makes the curve vanish silently, with no error anywhere.

import { parseDay, shippingEstimate } from "./domain.js";

// In viewBox units. The left gutter holds the y-axis values and the bottom band
// the dates, so no label sits outside the drawn box.
export const CHART = { w: 440, h: 188, top: 14, right: 14, bottom: 26, left: 46 };

// Past this many snapshots a dot per day turns the line into a bead string.
const MAX_DOTS = 20;

// The recorded snapshots never get less than this share of the x axis. Letting
// the projection set the span alone is what squeezed four relevés and a 39-day
// forecast into 7% of the width: 93% of the card was a dashed guess and the real
// curve was a 27px stub. Past the floor the forecast is clipped at the edge
// instead — it keeps its slope, it just stops being the subject of the chart.
const MIN_DATA_SHARE = 0.55;

// Axis steps rounded to 1/2/2.5/5 × 10ⁿ, so ticks read as round numbers rather
// than as the raw min and max of the data.
export function niceTicks(min, max, count = 4) {
  // A flat series would collapse the scale to a single tick and divide by zero.
  if (max === min) {
    min -= 1;
    max += 1;
  }

  const raw = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  // Positions count whole orders, so never label a fractional rank. The 2.5
  // multiplier is the one that can land fractional (at magnitude 1 it yields a
  // 2.5-place step), so integer candidates are filtered before choosing rather
  // than clamped afterwards — clamping only ever caught steps below 1.
  const step = Math.max(
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .find((s) => s >= raw && Number.isInteger(s)) ?? 1,
    1
  );

  // Round outwards on both ends: a domain stopping short of the extremes would
  // push the line outside the plot and clip it.
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(v);
  return ticks;
}

export function buildChartModel(history) {
  if (history.length < 2) return null;

  const { w, h, top, right, bottom, left } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const lastIndex = history.length - 1;

  // The x-axis spans real time rather than snapshot indexes — otherwise the
  // future date has nowhere to sit, and missed days plot as regular intervals.
  const estimate = shippingEstimate(history);
  const target = estimate?.date ?? null;
  const startDate = parseDay(history[0].date);
  const lastDate = parseDay(history[lastIndex].date);
  const dataSpan = lastDate - startDate || 1;

  // The forecast may stretch the axis, but only until the data hits its floor.
  const span = Math.min(target ? target - startDate : dataSpan, dataSpan / MIN_DATA_SHARE);
  const axisEnd = new Date(startDate.getTime() + span);

  // Where the dashed line leaves the chart: the target itself when it fits,
  // otherwise the right edge, at the rank the projection has reached by then.
  // The axis then only has to reach that rank, instead of down to 0 for a point
  // drawn off-screen.
  const clipped = target !== null && target > axisEnd;
  const projected = target && {
    date: clipped ? axisEnd : target,
    position: clipped
      ? (history[lastIndex].position * (target - axisEnd)) / (target - lastDate)
      : 0,
  };

  const positions = history.map((p) => p.position);
  const tickValues = niceTicks(
    Math.min(...positions, projected ? projected.position : Infinity),
    Math.max(...positions)
  );
  const lo = tickValues[0];
  const hi = tickValues[tickValues.length - 1];

  const xAt = (date) => left + ((date - startDate) / span) * plotW;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * plotH;
  const xs = history.map((p) => xAt(parseDay(p.date)));
  const x = (i) => xs[i];

  const endX = xs[lastIndex];
  const endY = y(history[lastIndex].position);
  // With a projection the last snapshot sits far from the right edge, so the
  // value label flips to the free side instead of hanging over the forecast.
  const labelLeft = endX > left + plotW * 0.6;

  return {
    geom: { w, h, top, right, bottom, left, plotW, plotH },
    lo,
    hi,
    baselineY: top + plotH,
    ticks: tickValues.map((value) => ({ value, y: y(value) })),
    points: history.map((entry, i) => ({ ...entry, x: xs[i], y: y(entry.position) })),
    startDate,
    lastDate,
    // `date` is where the dashed line stops, which is the estimated shipping
    // date only when it fits on the axis. `target` is always the real one, so
    // the caption can still name it when the line runs off the edge.
    projection: projected
      ? {
          date: projected.date,
          x: xAt(projected.date),
          y: y(projected.position),
          clipped,
          target,
        }
      : null,
    // Both ends always; the last snapshot only where it will not collide with them.
    dateMarks: [
      { date: startDate, at: xAt(startDate), anchor: "start" },
      ...(xAt(lastDate) > left + plotW * 0.25 && xAt(lastDate) < left + plotW * 0.75
        ? [{ date: lastDate, at: xAt(lastDate), anchor: "middle" }]
        : []),
      ...(projected
        ? [{ date: projected.date, at: xAt(projected.date), anchor: "end" }]
        : [{ date: lastDate, at: xAt(lastDate), anchor: "end" }]),
    ],
    showDots: history.length <= MAX_DOTS,
    end: {
      x: endX,
      y: endY,
      position: history[lastIndex].position,
      labelLeft,
      labelX: labelLeft ? endX - 7 : endX + 7,
      labelY: Math.max(endY - 13, top + 11),
    },
    // The hover handler needs to map an index back to a coordinate.
    x,
    y,
  };
}
