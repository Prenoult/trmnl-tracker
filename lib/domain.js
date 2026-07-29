// Queue arithmetic. Pure functions only: no DOM, no I/O, no formatting.

import { RATE_WINDOW_DAYS } from "./config.js";

// Dates in history.json are plain UTC days ("2026-07-25"), so parse them as UTC:
// formatting them in a timezone west of Greenwich would otherwise shift every
// label back by a day.
export const parseDay = (s) => new Date(`${s}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
export const addDays = (date, n) => new Date(date.getTime() + n * 86400000);

// French only pluralises from two upwards, so zero stays singular ("0 place").
export const plural = (n, s = "s") => (Math.abs(n) > 1 ? s : "");

// TRMNL publishes the *current* queue size ("in a queue of N orders"), not a
// running total: it shrinks as soon as more orders ship than come in. Comparing
// two totals therefore yields the net balance, not the orders added. The places
// we gain are the orders that left the queue ahead of us (it is FIFO), and what
// happened behind us is what remains:
//   netAdded = queue delta + places gained
//
// Net, and negative when orders vanish from behind our position — a cancellation,
// a refund, or TRMNL recounting what it calls the queue. The identity credits
// every departure to shipping at the front, so a departure from behind arrives
// here with a minus sign: on 2026-07-28 the queue fell by 48 while we moved up
// only 5 places, and the 43 orders that left from behind us read as -43.
export function movement(prev, curr) {
  const gained = prev.position - curr.position;
  return {
    gained,
    netAdded: curr.total - prev.total + gained,
    days: Math.max(1, daysBetween(prev.date, curr.date)),
  };
}

// Beyond this the projection is noise, not a date.
const HORIZON_DAYS = 3650;

// Least-squares slope of position against elapsed days across the whole window.
// The difference between the two endpoints — what this replaces — gave the
// snapshots in between no vote at all, so one noisy first or last relevé moved
// the estimate by weeks. Regressing on the dates (not on the indexes) keeps a
// skipped day from counting as a full day of progress.
//
// Returns null when every snapshot in the window shares a date: no slope exists.
function fitRate(window) {
  const n = window.length;
  const t = window.map((entry) => daysBetween(window[0].date, entry.date));
  const y = window.map((entry) => entry.position);
  const meanT = t.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let stt = 0;
  let sty = 0;
  for (let i = 0; i < n; i++) {
    stt += (t[i] - meanT) ** 2;
    sty += (t[i] - meanT) * (y[i] - meanY);
  }
  if (stt === 0) return null;

  const slope = sty / stt;

  // Standard error of the slope, which needs a residual degree of freedom: on
  // two points the fit is exact and the uncertainty is unknown, not zero. Left
  // null there rather than reported as 0, so the caller shows no false range.
  let stdError = null;
  if (n > 2) {
    const intercept = meanY - slope * meanT;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * t[i])) ** 2;
    stdError = Math.sqrt(sse / (n - 2) / stt);
  }

  // Ranks count down, so a falling line is forward progress. A flat one negates
  // to -0, which formats as "-0 place/jour" on the card.
  return { rate: slope === 0 ? 0 : -slope, stdError };
}

const daysAtRate = (position, rate) => (rate > 0 ? Math.ceil(position / rate) : null);

const dateAtRate = (from, daysLeft) =>
  daysLeft === null || daysLeft > HORIZON_DAYS ? null : addDays(from, daysLeft);

// Rate over the last few snapshots rather than the average since day one: it
// stays honest if TRMNL's shipping cadence speeds up or slows down.
//
// Note the window is an *index* offset, so when the daily workflow skips a day
// it covers the last RATE_WINDOW_DAYS snapshots rather than that many calendar
// days. spanDays is measured from the real dates, so the rate stays correct and
// the caller can report the true window length.
export function shippingEstimate(history) {
  if (history.length < 2) return null;

  const window = history.slice(Math.max(0, history.length - 1 - RATE_WINDOW_DAYS));
  const latest = window[window.length - 1];
  const spanDays = daysBetween(window[0].date, latest.date);
  if (spanDays <= 0) return null;

  const fit = fitRate(window);
  if (!fit) return null;

  const { rate, stdError } = fit;
  if (rate <= 0) return { rate, spanDays, daysLeft: null, date: null, range: null };

  const from = parseDay(latest.date);
  const daysLeft = daysAtRate(latest.position, rate);

  return {
    rate,
    spanDays,
    daysLeft,
    date: dateAtRate(from, daysLeft),
    // One standard error either side of the fitted rate: a queue moving faster
    // than the fit ships earlier, a slower one later. The late bound goes null
    // when the slow end allows a stalled queue, because "never" is not a date.
    range:
      stdError > 0
        ? {
            earliest: dateAtRate(from, daysAtRate(latest.position, rate + stdError)),
            latest: dateAtRate(from, daysAtRate(latest.position, rate - stdError)),
          }
        : null,
  };
}
