// data/status.json is a one-shot flag, separate from history.json: it exists only
// once trmnl.com reports the order shipped, and never changes again after that —
// the queue tracker has nothing left to measure. Kept out of history.json rather
// than added as an optional field there, so the strict {date,position,total} shape
// every consumer of that file relies on never has to grow a case they all have to
// check for.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same posture as parseHistory: throws on anything that is not well-formed, so a
// corrupt file reads as "broken", not as "not shipped".
export function parseStatus(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`status.json is not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`status.json must be an object, got ${JSON.stringify(data)}`);
  }
  if (!DATE_RE.test(data.shippedDate)) {
    throw new Error(`status.json: bad shippedDate ${JSON.stringify(data.shippedDate)}`);
  }
  return data;
}
