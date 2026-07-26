// The history file is the whole datastore, committed to git by the daily
// workflow. Everything that reads or writes it goes through here, because a bad
// write is pushed to the repository before anyone sees it.

import { STALE_AFTER_DAYS } from "./config.js";
import { daysBetween } from "./domain.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A regex that half-matches a reworded TRMNL page could yield a plausible-looking
// number, so bound how far a snapshot may move. Relative alone would reject the
// legitimate 20 → 5 jump at the head of the queue; absolute alone would reject
// nothing at 1500. A value has to break both bounds to be rejected.
const MAX_ABS_JUMP = 100;
const MAX_REL_JUMP = 0.5;

function assertShape(entry, where) {
  if (!entry || typeof entry !== "object") throw new Error(`${where}: not an object`);
  if (!DATE_RE.test(entry.date)) throw new Error(`${where}: bad date ${JSON.stringify(entry.date)}`);
  for (const key of ["position", "total"]) {
    const value = entry[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${where}: ${key} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
  if (entry.position > entry.total) {
    throw new Error(`${where}: position ${entry.position} exceeds queue size ${entry.total}`);
  }
}

// Throws on anything that is not a well-formed history. The caller must treat an
// unreadable file as a failure and leave it alone: silently falling back to an
// empty array would rewrite the file with a single entry and destroy the series.
export function parseHistory(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`history.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(data)) throw new Error(`history.json must be an array, got ${typeof data}`);
  data.forEach((entry, i) => assertShape(entry, `history[${i}]`));
  return data;
}

// Called on the freshly scraped values, before they can reach the file.
export function validateSnapshot(entry, previous = null) {
  assertShape(entry, "snapshot");
  if (!previous) return entry;

  for (const key of ["position", "total"]) {
    const delta = Math.abs(entry[key] - previous[key]);
    if (delta > MAX_ABS_JUMP && delta > previous[key] * MAX_REL_JUMP) {
      throw new Error(
        `snapshot: ${key} jumped from ${previous[key]} to ${entry[key]} since ${previous.date} — ` +
          `refusing to write, the tracker page has probably changed`
      );
    }
  }
  return entry;
}

// One entry per day: a re-run on the same day corrects that day rather than
// adding a second point. Returns a new array; does not mutate the input.
export function upsertSnapshot(history, entry) {
  const index = history.findIndex((h) => h.date === entry.date);
  const next = index === -1 ? [...history, entry] : history.with(index, entry);
  return next.sort((a, b) => a.date.localeCompare(b.date));
}

// A failed workflow just skips a day, and the page would keep showing the old
// position as though it were current.
export function staleness(history, today) {
  if (!history.length) return { days: null, stale: false };
  const days = daysBetween(history[history.length - 1].date, today);
  return { days, stale: days > STALE_AFTER_DAYS };
}
