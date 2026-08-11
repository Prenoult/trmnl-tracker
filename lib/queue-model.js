// Geometry for the queue lane: the whole queue drawn as a single rank axis, from
// the order shipping next (rank 1, at the left) to the back of the queue (rank
// `total`, at the right), with the tracked order marked on it.
//
// The chart answers "how fast"; this answers "where". They are different
// questions and the position number alone answers neither: #1114 means nothing
// until you can see it sitting between the 1113 orders that ship first and the
// 497 that arrived after.
//
// Same split as chart-model.js and for the same reason: this returns plain
// numbers, app.js is a template over them, and a NaN reaching an SVG attribute
// is a shape that silently fails to draw rather than an error anyone sees.

// In viewBox units. The bands stack: chip, then the marker's upper overhang,
// then the comb, then its lower overhang, then the travel trail.
export const QUEUE = {
  w: 440,
  left: 10,
  right: 10,
  chipTop: 10,
  chipH: 22,
  chipW: 52,
  laneTop: 46,
  laneH: 34,
  // How far the marker bar stands out of the track, each side, so it reads as a
  // marker on the queue rather than as one more (taller) tick in it.
  overhang: 10,
  // The track the comb sits in: the queue as an object, so the ticks read as
  // something held rather than as a row of marks floating on the card.
  trackPad: 5,
  trailY: 96,
  labelY: 108,
  // Height with and without the travel trail below the lane: a first relevé has
  // nothing to trail from, and 18 units of empty card is a drawing mistake.
  h: 112,
  hBare: 94,
  // Ticks tile the lane: this is the gap between them, and the smallest a tick
  // may be drawn before the comb turns into a solid bar.
  tickGap: 2.2,
  minTickW: 2.2,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A rank lands at the *centre* of its share of the lane, not at its edge: rank 1
// of 1611 is the first slice of the queue, not the point where the queue starts.
// It also keeps rank 1 and rank `total` inside the drawn lane instead of hanging
// half a tick off either end.
const fractionOf = (rank, total) => clamp((rank - 0.5) / total, 0, 1);

// Number of ticks the lane holds, capped at one per order: a queue of five
// orders draws five blocks rather than ninety ticks of one fifth of an order,
// which would be a texture claiming a precision the data does not have.
function tickLayout(laneW, total) {
  const count = Math.max(1, Math.min(Math.floor(laneW / (QUEUE.minTickW + QUEUE.tickGap)), total));
  const step = laneW / count;
  return { count, step, width: Math.max(1, step - QUEUE.tickGap) };
}

// `latest` is the snapshot being drawn; `first` is the oldest one, which becomes
// the ghost marker the trail runs from. Pass null for it on a one-relevé
// history — there is no travel to draw yet.
export function buildQueueModel(latest, first = null) {
  if (!latest) return null;

  const total = Math.round(latest.total);
  const position = Math.round(latest.position);
  // A queue that cannot hold the order in it has no lane to draw. The scraper's
  // own bounds should have rejected this first; the front end still refuses to
  // divide by it.
  if (!Number.isFinite(total) || !Number.isFinite(position) || total < 1) return null;

  const { w, left, right, laneTop, laneH, overhang, trackPad, chipW, chipH, chipTop } = QUEUE;
  const laneW = w - left - right;
  const xAt = (rank) => left + fractionOf(rank, total) * laneW;

  const x = xAt(position);
  const { count, step, width } = tickLayout(laneW, total);
  const markerFraction = fractionOf(position, total);

  // Which side of the marker each tick falls on. The comb is a texture at bucket
  // resolution — one tick is `total / count` orders — so this classification is
  // out by up to half a tick at the boundary. The two counts below are exact and
  // printed as figures; nothing is read off the comb.
  const ticks = Array.from({ length: count }, (_, i) => ({
    x: left + i * step + (step - width) / 2,
    width,
    ahead: (i + 0.5) / count < markerFraction,
  }));

  const top = laneTop - overhang;
  const bottom = laneTop + laneH + overhang;
  const chipX = clamp(x - chipW / 2, left, w - right - chipW);

  // The oldest rank on today's axis. Both are ranks, so they belong on the same
  // scale; a queue that has since shrunk below it puts the ghost at the very
  // back of the lane, which is where it was, with `clamped` saying so.
  const startRank = first ? Math.round(first.position) : null;
  const startX = startRank === null ? null : xAt(clamp(startRank, 1, total));
  // Under a tick and a half apart the ghost and the marker overlap into one
  // smudge, and the trail between them has no room for an arrow, let alone a
  // label. Nothing moved worth drawing, so both go — they are one figure, and
  // a ghost with no trail is a second marker with nothing to say.
  const trailW = startX === null ? 0 : Math.abs(startX - x);
  const hasTrail = trailW >= 1.5 * (width + QUEUE.tickGap);

  return {
    geom: {
      ...QUEUE,
      laneW,
      h: hasTrail ? QUEUE.h : QUEUE.hBare,
      laneBottom: laneTop + laneH,
      track: {
        x: left - trackPad,
        y: laneTop - trackPad,
        width: laneW + 2 * trackPad,
        height: laneH + 2 * trackPad,
        rx: trackPad + 4,
      },
    },
    position,
    total,
    // Exact, and the reason the comb never has to be counted: the orders that
    // ship before this one, and the ones that arrived after it. They sum to
    // total − 1, the queue minus the order itself.
    ahead: position - 1,
    behind: Math.max(0, total - position),
    share: markerFraction,
    // Orders per tick, so the caption can say what one tick is worth instead of
    // letting the comb imply one tick per order.
    perTick: total / count,
    ticks,
    // The wash across the ticks ahead runs from the shipping end to the marker,
    // so the fade lands exactly where the marker is. Degenerate when the order is
    // at the front of the queue, where a zero-width gradient renders as its last
    // stop rather than as an error — nudged anyway, since that is a browser
    // detail and not something to rely on.
    beam: { from: left, to: Math.max(x, left + 1) },
    marker: {
      x,
      top,
      bottom,
      // The chip stays inside the card even when the marker is at either end of
      // the lane, so its pointer is tracked separately: it follows the marker
      // through the middle of the lane, and stops at the chip's own shoulder
      // rather than tearing off the box it belongs to.
      chipX,
      chipY: chipTop,
      chipW,
      chipH,
      chipTipX: clamp(x, chipX + 10, chipX + chipW - 10),
      chipTipY: chipTop + chipH,
    },
    start: !hasTrail
      ? null
      : {
          position: startRank,
          x: startX,
          clamped: startRank > total,
          top,
          bottom: QUEUE.trailY,
        },
    trail: !hasTrail
      ? null
      : {
          from: Math.min(startX, x),
          to: Math.max(startX, x),
          y: QUEUE.trailY,
          width: trailW,
          // Which way the order travelled: -1 towards the front of the queue
          // (places gained), +1 back down it. The arrowhead sits on the marker
          // end either way, because that is the end that is now.
          direction: x < startX ? -1 : 1,
          gained: startRank - position,
          labelX: clamp((startX + x) / 2, left + chipW, w - right - chipW),
          labelY: QUEUE.labelY,
        },
  };
}
