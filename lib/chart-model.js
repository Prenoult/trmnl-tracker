// Chart geometry, separated from the SVG it feeds so the maths can be tested
// without a DOM. buildChartModel returns numbers; renderChart in app.js is a
// template over them.
//
// The failure mode this split guards against: a single NaN in a path's `d`
// attribute makes the curve vanish silently, with no error anywhere.

import { movement, parseDay, paceSeries, shippingEstimate } from "./domain.js";

// In viewBox units. The left gutter holds the y-axis values and the bottom band
// the dates, so no label sits outside the drawn box.
export const CHART = { w: 440, h: 188, top: 14, right: 14, bottom: 26, left: 46 };

// The strip of per-relevé gains under the curve, on the same x axis. Its own
// height, because it is a different measure — a quantity per interval, not a
// level — and its own baseline, which is not the curve's.
export const BARS = { h: 64, top: 8, bottom: 18 };

// The surface gap between two columns. Shrinks on a dense history rather than
// eating the columns it separates.
const BAR_GAP = 2;

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

// The curve above is cumulative, so it smooths the one thing the shipping
// estimate rests on: a relevé that gained one place and one that gained seventy
// read as much the same slope. Columns rather than a second line, because each
// value is a quantity for one interval, not a level that continues between
// relevés — and on the same x mapping as the curve, so the strip is another panel
// on one time axis rather than a second chart with its own idea of when.
function buildBars(history, xs) {
  const steps = history.slice(1).map((entry, i) => ({
    date: entry.date,
    from: xs[i],
    to: xs[i + 1],
    x: xs[i + 1],
    ...movement(history[i], entry),
  }));

  // Places per day, not places gained. A column has to answer for the whole
  // interval it covers: when the workflow skips days, one relevé carries several
  // days of movement, and drawing that as a single column the height of a normal
  // one claims a cadence that never happened — a +40 over four days is 10/day,
  // and it drew exactly like a +40 in one day. The column spans its interval
  // instead, so its *area* is the places gained and its height is the rate.
  // Where every relevé is a day apart — the normal case — the two are the same
  // number and nothing changes.
  const rates = steps.map((step) => step.gained / step.days);
  // Aligned to steps (drop the leading null for the first snapshot, which has
  // no window yet): the smoothed rate the ETA card is actually using, as of
  // each relevé, so the trend line answers "is the pace itself changing"
  // where the bars alone only show day-to-day noise.
  const pace = paceSeries(history).slice(1);

  // A relevé that lost ground draws below the baseline, so the scale holds both
  // signs. Floored at one so a series that never moved still has a span to
  // divide by. The trend line shares this scale — it has to, to sit next to the
  // bars it is smoothing — so its own extremes count too, or a pace steadier
  // than any single day would run off the top of the strip.
  const hi = Math.max(0, ...rates, ...pace.filter((v) => v !== null));
  const lo = Math.min(0, ...rates, ...pace.filter((v) => v !== null));
  const span = Math.max(1, hi - lo);

  const plotH = BARS.h - BARS.top - BARS.bottom;
  const y = (v) => BARS.top + ((hi - v) / span) * plotH;
  const baselineY = y(0);

  return {
    geom: { ...BARS, plotH },
    baselineY,
    max: hi,
    min: lo,
    // The columns tile the observed span, so the strip ends where the relevés do
    // rather than running on under the forecast, where there is nothing to
    // measure and a baseline would read as a row of zeros.
    from: xs[0],
    to: xs[xs.length - 1],
    columns: steps.map((step) => {
      const rate = step.gained / step.days;
      const bin = step.to - step.from;
      // The gap between columns never eats more than a quarter of the bin, so a
      // dense history keeps drawing columns rather than dissolving into it.
      const gap = Math.min(BAR_GAP, bin * 0.25);

      // Same rule as the axis rounding: a real value never renders as nothing.
      // One place a day against a seventy-place day is half a pixel, and erasing
      // it would hide exactly the unevenness this strip exists to show.
      //
      // The floor is applied before the anchor, not after: raising the height
      // against the measured top left the column hanging through the baseline by
      // the difference.
      const height = rate === 0 ? 0 : Math.max(1.5, Math.abs(baselineY - y(rate)));

      return {
        ...step,
        rate,
        left: step.from + gap / 2,
        width: Math.max(1, bin - gap),
        y: rate >= 0 ? baselineY - height : baselineY,
        height,
      };
    }),
    // One point per relevé, at the date it applies to (a bar's right edge),
    // skipping the leading snapshot a rolling fit has no window for yet. A
    // series this short — one or two relevés past the first — draws no line at
    // all rather than one point with nothing to connect it to.
    trend: steps
      .map((step, i) => (pace[i] === null ? null : { x: step.to, y: y(pace[i]) }))
      .filter((p) => p !== null),
  };
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

  // Position and queue size are the same unit on the same scale — a rank never
  // exceeds the queue holding it — so they share one axis. Two y-scales for two
  // measures of the same thing would be a dual axis, which is never the answer,
  // and the gap between the two lines would stop meaning anything. That gap is
  // the orders sitting behind us, which is the reason to draw the second line.
  const positions = history.map((p) => p.position);
  const totals = history.map((p) => p.total);
  const tickValues = niceTicks(
    Math.min(...positions, projected ? projected.position : Infinity),
    Math.max(...positions, ...totals)
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
    totalPoints: history.map((entry, i) => ({ ...entry, x: xs[i], y: y(entry.total) })),
    bars: buildBars(history, xs),
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
