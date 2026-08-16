// A small calendar page for the estimated shipping date. The ETA card says
// "Mercredi 16 septembre 2026" and, in prose, the range around it — this answers
// the question the sentence leaves to arithmetic: which day of the week, and
// how does the range sit against it. Pure data, no DOM: buildCalendarModel
// returns a grid of days; app.js is a template over it, same split as the chart
// and the queue lane.

import { addDays, parseDay } from "./domain.js";

const weekdayIndex = (date) => (date.getUTCDay() + 6) % 7; // Monday = 0

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEnd(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

const sameDay = (a, b) => !!a && !!b && a.getTime() === b.getTime();

// today: "YYYY-MM-DD", the same string app.js derives everywhere else. target:
// the estimated shipping date, a Date, or null when shippingEstimate has none.
// range: shippingEstimate's own { earliest, latest } (latest may be null on an
// open-ended range), or null on two snapshots where no spread exists yet.
//
// Only the month target falls in is drawn — a range reaching past its edges is
// clipped there rather than pulling in a second month, the trade-off the
// chart's own axis already makes for the projection. clippedBefore/After say
// so; openEnded says the far side was never a date to begin with.
export function buildCalendarModel(today, target, range) {
  if (!target) return null;

  const todayDate = parseDay(today);
  const start = monthStart(target);
  const end = monthEnd(target);
  const gridStart = addDays(start, -weekdayIndex(start));
  const gridEnd = addDays(end, 6 - weekdayIndex(end));

  const earliest = range?.earliest ?? null;
  const openEnded = !!range && range.latest === null;
  // An unbounded slow side still needs an edge to shade the band to. It is not
  // the real bound — there isn't one — but "and beyond" needs somewhere to stop
  // drawing, and the edge of the page it's drawn on is an honest place for that.
  const latest = range ? (range.latest ?? gridEnd) : null;

  const days = [];
  for (let d = gridStart; d.getTime() <= gridEnd.getTime(); d = addDays(d, 1)) {
    days.push({
      date: d,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === target.getUTCMonth(),
      isToday: sameDay(d, todayDate),
      isTarget: sameDay(d, target),
      inRange: !!earliest && !!latest && d.getTime() >= earliest.getTime() && d.getTime() <= latest.getTime(),
    });
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return {
    month: start,
    weeks,
    openEnded,
    clippedBefore: !!earliest && earliest.getTime() < gridStart.getTime(),
    clippedAfter: !openEnded && !!range?.latest && range.latest.getTime() > gridEnd.getTime(),
  };
}
