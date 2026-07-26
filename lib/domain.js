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
// we gain are the orders that left the queue ahead of us (it is FIFO), and the
// new orders are what remains:
//   added = queue delta + places gained
export function movement(prev, curr) {
  const gained = prev.position - curr.position;
  return {
    gained,
    added: curr.total - prev.total + gained,
    days: Math.max(1, daysBetween(prev.date, curr.date)),
  };
}

// Rate over the last few snapshots rather than the average since day one: it
// stays honest if TRMNL's shipping cadence speeds up or slows down.
//
// Note the window is an *index* offset, so when the daily workflow skips a day
// it covers the last RATE_WINDOW_DAYS snapshots rather than that many calendar
// days. spanDays is measured from the real dates, so the rate stays correct and
// the caller can report the true window length.
export function shippingEstimate(history) {
  if (history.length < 2) return null;

  const latest = history[history.length - 1];
  const start = history[Math.max(0, history.length - 1 - RATE_WINDOW_DAYS)];
  const spanDays = daysBetween(start.date, latest.date);
  if (spanDays <= 0) return null;

  const rate = (start.position - latest.position) / spanDays;
  if (rate <= 0) return { rate, spanDays, daysLeft: null, date: null };

  const daysLeft = Math.ceil(latest.position / rate);
  return {
    rate,
    spanDays,
    daysLeft,
    // Beyond a 10-year horizon the projection is noise; drop the date.
    date: daysLeft > 3650 ? null : addDays(parseDay(latest.date), daysLeft),
  };
}
