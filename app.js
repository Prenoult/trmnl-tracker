const ORDER_NUMBER = "51230";

// The UI is French; keep every Intl formatter on one locale.
const LOCALE = "fr-FR";

// Window (in days) used to estimate how fast the queue is moving.
const RATE_WINDOW_DAYS = 7;

const fmt = new Intl.NumberFormat(LOCALE);
const rateFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const longDateFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Dates in history.json are plain UTC days ("2026-07-25"), so parse them as UTC:
// formatting them in a timezone west of Greenwich would otherwise shift every
// label back by a day.
const parseDay = (s) => new Date(`${s}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
// French only pluralises from two upwards, so zero stays singular ("0 place").
const plural = (n, s = "s") => (Math.abs(n) > 1 ? s : "");

// TRMNL publishes the *current* queue size ("in a queue of N orders"), not a
// running total: it shrinks as soon as more orders ship than come in. Comparing
// two totals therefore yields the net balance, not the orders added. The places
// we gain are the orders that left the queue ahead of us (it is FIFO), and the
// new orders are what remains:
//   added = queue delta + places gained
function movement(prev, curr) {
  const gained = prev.position - curr.position;
  return {
    gained,
    added: curr.total - prev.total + gained,
    days: Math.max(1, daysBetween(prev.date, curr.date)),
  };
}

function setDelta(el, value, { invert = false, neutral = false } = {}) {
  if (value === null) {
    el.textContent = "–";
    el.className = "delta-value";
    return;
  }
  const good = !neutral && (invert ? value < 0 : value > 0);
  const bad = !neutral && (invert ? value > 0 : value < 0);
  el.textContent = `${value > 0 ? "+" : ""}${fmt.format(value)}`;
  el.className = "delta-value" + (good ? " positive" : bad ? " negative" : "");
}

// Rate over the last few days rather than the average since day one: it stays
// honest if TRMNL's shipping cadence speeds up or slows down.
function shippingEstimate(history) {
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

function renderEta(history) {
  const dateEl = document.getElementById("eta-date");
  const subEl = document.getElementById("eta-sub");
  const est = shippingEstimate(history);

  if (!est) {
    dateEl.textContent = "–";
    subEl.textContent = "Estimation disponible dès le deuxième relevé.";
    return;
  }

  const window =
    est.spanDays === 1 ? "depuis hier" : `sur les ${est.spanDays} derniers jours`;

  if (!est.date) {
    dateEl.textContent = "Indéterminée";
    subEl.textContent =
      est.rate <= 0
        ? `La file n'a pas avancé ${window}.`
        : `Au rythme actuel (${rateFmt.format(est.rate)} place${plural(est.rate)}/jour), l'échéance dépasse 10 ans.`;
    return;
  }

  dateEl.textContent = longDateFmt.format(est.date);
  subEl.textContent =
    `Dans environ ${fmt.format(est.daysLeft)} jour${plural(est.daysLeft)}, ` +
    `au rythme de ${rateFmt.format(est.rate)} place${plural(est.rate)}/jour observé ${window}.`;
}

// Chart geometry, in viewBox units. The left gutter holds the y-axis values and
// the bottom band the dates, so no label sits outside the drawn box.
const CHART = { w: 440, h: 188, top: 14, right: 14, bottom: 26, left: 46 };

// Axis steps rounded to 1/2/2.5/5 × 10ⁿ, so ticks read as round numbers rather
// than as the raw min and max of the data.
function niceTicks(min, max, count = 4) {
  // A flat series would collapse the scale to a single tick and divide by zero.
  if (max === min) {
    min -= 1;
    max += 1;
  }

  const raw = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  // Positions count whole orders, so never label a fractional rank.
  const step = Math.max([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw), 1);

  // Round outwards on both ends: a domain stopping short of the extremes would
  // push the line outside the plot and clip it.
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(v);
  return ticks;
}

function renderChart(history) {
  const el = document.getElementById("chart");
  const tableWrap = document.getElementById("chart-data");
  if (history.length < 2) {
    el.innerHTML = '<p class="empty-state">Revenez demain pour voir la courbe de progression.</p>';
    tableWrap.hidden = true;
    return;
  }

  const { w, h, top, right, bottom, left } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const lastIndex = history.length - 1;

  // The projection runs to position 0, so the axis has to reach 0 too, and the
  // x-axis has to span real time rather than snapshot indexes — otherwise the
  // future date has nowhere to sit (and missed days plot as regular intervals).
  const estimate = shippingEstimate(history);
  const projection = estimate?.date ?? null;
  const startDate = parseDay(history[0].date);
  const lastDate = parseDay(history[lastIndex].date);
  const endDate = projection ?? lastDate;
  const span = endDate - startDate || 1;

  const positions = history.map((p) => p.position);
  const ticks = niceTicks(projection ? 0 : Math.min(...positions), Math.max(...positions));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];

  const xAt = (date) => left + ((date - startDate) / span) * plotW;
  const xs = history.map((p) => xAt(parseDay(p.date)));
  const x = (i) => xs[i];
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * plotH;

  const line = history
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.position).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(lastIndex).toFixed(1)},${top + plotH} L${left},${top + plotH} Z`;

  const grid = ticks
    .map(
      (v) =>
        `<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${left + plotW}" y2="${y(v).toFixed(1)}" />` +
        `<text class="chart-axis" x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt.format(v)}</text>`
    )
    .join("");

  // Dashed, de-emphasised and unfilled: this segment is a forecast, not data.
  const projectionMark = projection
    ? `<path class="chart-projection" d="M${x(lastIndex).toFixed(1)},${y(history[lastIndex].position).toFixed(1)} L${xAt(projection).toFixed(1)},${y(0).toFixed(1)}" />` +
      `<circle class="chart-target" cx="${xAt(projection).toFixed(1)}" cy="${y(0).toFixed(1)}" r="3.5" />`
    : "";

  // Both ends always; the last snapshot only where it will not collide with them.
  const dateMarks = [
    { date: startDate, at: xAt(startDate), anchor: "start" },
    ...(xAt(lastDate) > left + plotW * 0.25 && xAt(lastDate) < left + plotW * 0.75
      ? [{ date: lastDate, at: xAt(lastDate), anchor: "middle" }]
      : []),
    ...(projection ? [{ date: projection, at: xAt(projection), anchor: "end" }] : []),
    ...(projection ? [] : [{ date: lastDate, at: xAt(lastDate), anchor: "end" }]),
  ];
  const dateLabels = dateMarks
    .map(
      (m) =>
        `<text class="chart-axis" x="${m.at.toFixed(1)}" y="${h - 8}" text-anchor="${m.anchor}">${dateFmt.format(m.date)}</text>`
    )
    .join("");

  // Past ~20 snapshots a dot per day turns the line into a bead string.
  const dots =
    history.length <= 20
      ? history
          .slice(0, -1)
          .map(
            (p, i) =>
              `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(p.position).toFixed(1)}" r="2.5" />`
          )
          .join("")
      : "";

  const endX = x(lastIndex);
  const endY = y(history[lastIndex].position);
  // With a projection the last snapshot sits far from the right edge, so the
  // value label flips to the free side instead of hanging over the forecast.
  const labelLeft = endX > left + plotW * 0.6;

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" role="img" tabindex="0"
      aria-label="Position dans la file du ${dateFmt.format(startDate)} au ${dateFmt.format(lastDate)}, de ${fmt.format(history[0].position)} à ${fmt.format(history[lastIndex].position)}.${projection ? ` Projection en pointillés jusqu'à la position 0 le ${dateFmt.format(projection)}.` : ""} Données détaillées dans le tableau sous le graphique.">
      <defs>
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop class="chart-area-from" offset="0%" />
          <stop class="chart-area-to" offset="100%" />
        </linearGradient>
      </defs>
      <g class="chart-grid">${grid}</g>
      <path class="chart-fill" d="${area}" />
      ${projectionMark}
      <path class="chart-line" d="${line}" />
      ${dots}
      <line class="chart-crosshair" y1="${top}" y2="${top + plotH}" />
      <circle class="chart-cursor" r="4.5" />
      <circle class="chart-end" cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5" />
      <text class="chart-end-label" x="${(labelLeft ? endX - 7 : endX + 7).toFixed(1)}" y="${Math.max(endY - 13, top + 11).toFixed(1)}" text-anchor="${labelLeft ? "end" : "start"}">#${fmt.format(history[lastIndex].position)}</text>
      ${dateLabels}
      <rect class="chart-hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" />
    </svg>
    <div class="chart-tooltip" hidden><span class="tt-date"></span><strong class="tt-value"></strong><span class="tt-meta"></span></div>
  `;

  wireChartHover(el, history, { x, y, toClientRatio: (i) => x(i) / w });
  renderChartTable(history);
  tableWrap.hidden = false;

  document.getElementById("chart-caption").textContent =
    "Position dans la file — plus bas = plus proche de l'expédition." +
    (projection ? " En pointillés : projection jusqu'à votre tour." : "");
}

// Crosshair + tooltip. The readout snaps to the nearest snapshot, so the reader
// aims at a date rather than at a 2px line; arrow keys drive the same readout.
function wireChartHover(el, history, { x, y, toClientRatio }) {
  const svg = el.querySelector("svg");
  const crosshair = el.querySelector(".chart-crosshair");
  const cursor = el.querySelector(".chart-cursor");
  const tooltip = el.querySelector(".chart-tooltip");
  const dateEl = tooltip.querySelector(".tt-date");
  const valueEl = tooltip.querySelector(".tt-value");
  const metaEl = tooltip.querySelector(".tt-meta");
  let active = null;

  function show(i) {
    active = i;
    const entry = history[i];
    const previous = i > 0 ? movement(history[i - 1], entry) : null;

    crosshair.setAttribute("x1", x(i));
    crosshair.setAttribute("x2", x(i));
    cursor.setAttribute("cx", x(i));
    cursor.setAttribute("cy", y(entry.position));
    svg.classList.add("is-active");

    // textContent throughout: never build this markup by string concatenation.
    dateEl.textContent = dateFmt.format(parseDay(entry.date));
    valueEl.textContent = `#${fmt.format(entry.position)}`;
    metaEl.textContent =
      (previous ? `${previous.gained > 0 ? "+" : ""}${fmt.format(previous.gained)} place${plural(previous.gained)} · ` : "") +
      `file de ${fmt.format(entry.total)}`;

    // On a card this narrow the bubble is wide enough to sit on top of the point
    // it describes, so park it in the half the pointer is not in.
    tooltip.hidden = false;
    const half = tooltip.offsetWidth / 2;
    tooltip.style.left =
      toClientRatio(i) < 0.5 ? `${el.clientWidth - half - 4}px` : `${half + 4}px`;
  }

  function hide() {
    active = null;
    svg.classList.remove("is-active");
    tooltip.hidden = true;
  }

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const viewX = ((clientX - rect.left) / rect.width) * CHART.w;
    let best = 0;
    for (let i = 1; i < history.length; i++) {
      if (Math.abs(x(i) - viewX) < Math.abs(x(best) - viewX)) best = i;
    }
    return best;
  }

  svg.addEventListener("pointermove", (e) => show(nearestIndex(e.clientX)));
  svg.addEventListener("pointerdown", (e) => show(nearestIndex(e.clientX)));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      e.preventDefault();
      const from = active ?? (step > 0 ? -1 : history.length);
      show(Math.min(history.length - 1, Math.max(0, from + step)));
    } else if (e.key === "Escape") {
      hide();
    }
  });
}

// The table view keeps every value reachable without hovering.
function renderChartTable(history) {
  const body = document.getElementById("chart-table-body");
  body.replaceChildren();

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const previous = i > 0 ? movement(history[i - 1], entry) : null;
    const row = document.createElement("tr");

    for (const value of [
      dateFmt.format(parseDay(entry.date)),
      `#${fmt.format(entry.position)}`,
      fmt.format(entry.total),
      previous ? `${previous.gained > 0 ? "+" : ""}${fmt.format(previous.gained)}` : "–",
      previous ? `${previous.added > 0 ? "+" : ""}${fmt.format(previous.added)}` : "–",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

async function main() {
  document.getElementById("order-number").textContent = ORDER_NUMBER;

  let history;
  try {
    const res = await fetch("data/history.json", { cache: "no-store" });
    history = await res.json();
  } catch {
    history = [];
  }

  if (!history.length) {
    document.getElementById("summary").innerHTML =
      '<p class="empty-state">Aucune donnée pour le moment.</p>';
    return;
  }

  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const first = history[0];
  const last = previous ? movement(previous, latest) : null;

  document.getElementById("position").textContent = `#${fmt.format(latest.position)}`;
  document.getElementById("total").textContent = fmt.format(latest.total);

  setDelta(document.getElementById("delta-position"), last ? last.gained : null);
  // Orders joining the queue behind us do not change our position: the figure is
  // informational, so it gets no good/bad colour.
  setDelta(document.getElementById("delta-total"), last ? last.added : null, { neutral: true });

  // The daily snapshot can skip a day (failed workflow), so name the reference date.
  const sinceLabel = !last
    ? "depuis le dernier relevé"
    : last.days === 1
      ? "depuis hier"
      : `depuis le ${dateFmt.format(parseDay(previous.date))}`;
  for (const el of document.querySelectorAll(".delta-since")) el.textContent = sinceLabel;

  renderEta(history);
  renderChart(history);

  const totalGain = first.position - latest.position;
  const totalAdded = history
    .slice(1)
    .reduce((sum, entry, i) => sum + movement(history[i], entry).added, 0);
  const daysTracked = Math.max(1, daysBetween(first.date, latest.date));
  const summaryEl = document.getElementById("summary");

  if (history.length < 2) {
    summaryEl.innerHTML = `Premier relevé enregistré le ${dateFmt.format(parseDay(latest.date))} — la progression s'affichera à partir de demain.`;
  } else {
    summaryEl.innerHTML =
      `Depuis le ${dateFmt.format(parseDay(first.date))}, vous avez gagné ` +
      `<strong>${fmt.format(totalGain)} place${plural(totalGain)}</strong> en ` +
      `<strong>${daysTracked} jour${plural(daysTracked)}</strong> de suivi, pendant que ` +
      `<strong>${fmt.format(totalAdded)} nouvelle${plural(totalAdded)} commande${plural(totalAdded)}</strong> ` +
      `rejoignai${plural(totalAdded, "en")}t la file.`;
  }

  document.getElementById("last-updated").textContent =
    `Dernière mise à jour : ${dateFmt.format(parseDay(latest.date))}`;
}

main();
