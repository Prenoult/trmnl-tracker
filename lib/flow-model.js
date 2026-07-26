// The two things the position curve cannot show: where the movement came from,
// and how uneven it is from one day to the next.
//
// Both are magnitude comparisons across a handful of labelled rows, which is a
// bar list's job rather than a second chart's — so this module returns values and
// tick counts, and app.js renders them as metered rows. Same split as
// chart-model.js: the numbers are testable without a DOM.

import { RATE_WINDOW_DAYS } from "./config.js";
import { daysBetween, movement } from "./domain.js";

// Ticks per meter. Enough that a small value still reads as a share of the row,
// few enough that each tick stays a tick rather than a hairline at phone widths.
export const METER_TICKS = 40;

// Anything above zero gets at least one tick. A day that gained a single place is
// exactly the story a card about cadence exists to tell, and rounding it to an
// empty track would erase it.
export function ticksFor(value, max) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(1, Math.min(METER_TICKS, Math.round((value / max) * METER_TICKS)));
}

export function buildFlowModel(history) {
  if (history.length < 2) return null;

  // The window the shipping estimate fits its rate over, so this card reads as
  // the evidence behind that estimate rather than as a second, differently
  // scoped opinion of the same queue.
  const window = history.slice(Math.max(0, history.length - 1 - RATE_WINDOW_DAYS));
  const steps = window.slice(1).map((entry, i) => ({
    date: entry.date,
    ...movement(window[i], entry),
  }));

  // Orders that left the queue ahead of us against orders that joined behind us:
  // two quantities, one scale, because the comparison is the point.
  const shipped = steps.reduce((sum, step) => sum + step.gained, 0);
  const joined = steps.reduce((sum, step) => sum + step.added, 0);
  const flowMax = Math.max(shipped, joined);
  const dailyMax = Math.max(...steps.map((step) => step.gained));

  return {
    spanDays: daysBetween(window[0].date, window[window.length - 1].date),
    flow: [
      { key: "shipped", value: shipped, ticks: ticksFor(shipped, flowMax) },
      { key: "joined", value: joined, ticks: ticksFor(joined, flowMax) },
    ],
    // Newest first: the card is read top down, and the freshest relevé is the one
    // being compared against. `days` is carried so a step that covers a skipped
    // day can say so — otherwise it reads as one very good day.
    daily: steps
      .map((step) => ({
        date: step.date,
        days: step.days,
        value: step.gained,
        ticks: ticksFor(step.gained, dailyMax),
      }))
      .reverse(),
  };
}
