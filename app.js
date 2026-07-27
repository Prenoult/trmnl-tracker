// Front end: reads data/history.json and renders it. All the arithmetic lives in
// lib/ so it can be tested without a browser; what is left here is formatting and
// DOM.

import { ORDER_NUMBER } from "./lib/config.js";
import { parseDay, daysBetween, plural, movement, shippingEstimate } from "./lib/domain.js";
import { buildChartModel } from "./lib/chart-model.js";
import { parseHistory, staleness } from "./lib/history.js";

// The UI is French; keep every Intl formatter on one locale.
const LOCALE = "fr-FR";

const fmt = new Intl.NumberFormat(LOCALE);
const rateFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
// Abbreviated French months carry a trailing period ("10 sept."), which collides
// with the full stop ending a sentence. Prose gets the unabbreviated month; the
// axis labels and the table, where space is tight, keep the short one.
const proseDateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long" });
const longDateFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

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

// A failed workflow silently skips a day, and every figure on the page would
// otherwise read as today's.
function renderStale(history, today) {
  const el = document.getElementById("stale-banner");
  const { days, stale } = staleness(history, today);
  if (!stale) {
    el.hidden = true;
    return;
  }
  el.textContent =
    `Dernier relevé il y a ${fmt.format(days)} jour${plural(days)} : ` +
    `la mise à jour quotidienne semble en échec, les chiffres ci-dessous ne sont plus à jour.`;
  el.hidden = false;
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
    `au rythme de ${rateFmt.format(est.rate)} place${plural(est.rate)}/jour observé ${window}.` +
    spread(est.range);
}

// The date above is a single day computed from a fitted line; the relevés are
// nowhere near that regular. Naming how far the fit itself can slide keeps the
// headline from reading as a promise.
function spread(range) {
  if (!range) return "";
  if (range.earliest && range.latest) {
    return ` Selon l'irrégularité des relevés : entre le ${proseDateFmt.format(range.earliest)} et le ${proseDateFmt.format(range.latest)}.`;
  }
  if (range.earliest) {
    return ` Au mieux le ${proseDateFmt.format(range.earliest)} ; les relevés sont trop irréguliers pour borner l'autre côté.`;
  }
  return "";
}

// The strip under the curve. Direct-labelled at the endpoint only: a number on
// every column is noise, and every other value stays reachable through the hover
// readout and the table.
function barStrip(model) {
  const { w, left } = model.geom;
  const { columns, baselineY, max, from, to, geom } = model.bars;
  const latest = columns[columns.length - 1];

  const rects = columns
    .map(
      (c) =>
        `<rect class="bar${c.rate < 0 ? " is-loss" : ""}" x="${c.left.toFixed(1)}" ` +
        `y="${c.y.toFixed(1)}" width="${c.width.toFixed(1)}" height="${c.height.toFixed(1)}" rx="1.5" />`
    )
    .join("");

  // Above the column, but never above the strip: a one-place gain sits a hair off
  // the baseline, where the label has to clear the rule without riding out of the
  // box. It carries the same surface halo as the curve's end label, so it stays
  // legible wherever the column leaves it.
  const labelY = Math.max(geom.top + 9, Math.min(latest.y, baselineY) - 8);

  return `
    <svg class="chart-bars" viewBox="0 0 ${w} ${geom.h}" role="img"
      aria-label="Places gagnées par jour à chaque relevé, de ${rateFmt.format(Math.min(...columns.map((c) => c.rate)))} à ${rateFmt.format(max)}. Détail dans le tableau sous le graphique.">
      <text class="chart-axis" x="${left - 8}" y="${geom.top + 4}" text-anchor="end">${rateFmt.format(max)}</text>
      <line class="bar-baseline" x1="${from.toFixed(1)}" y1="${baselineY.toFixed(1)}" x2="${to.toFixed(1)}" y2="${baselineY.toFixed(1)}" />
      ${rects}
      <text class="bar-label" x="${(latest.left + latest.width / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${latest.rate > 0 ? "+" : ""}${rateFmt.format(latest.rate)}</text>
    </svg>`;
}

function renderChart(history) {
  const el = document.getElementById("chart");
  const tableWrap = document.getElementById("chart-data");
  const model = buildChartModel(history);

  if (!model) {
    el.innerHTML = '<p class="empty-state">Revenez demain pour voir la courbe de progression.</p>';
    tableWrap.hidden = true;
    return;
  }

  const { geom, points, ticks, projection, dateMarks, end, baselineY } = model;
  const { w, h, top, left, plotW, plotH } = geom;
  const last = points[points.length - 1];

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${last.x.toFixed(1)},${baselineY} L${left},${baselineY} Z`;

  // Queue size, on the same axis: the gap between the two lines is the orders
  // sitting behind us. No fill and a thinner stroke — it is context, the position
  // is the subject.
  const totalLine = model.totalPoints
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${left}" y1="${t.y.toFixed(1)}" x2="${left + plotW}" y2="${t.y.toFixed(1)}" />` +
        `<text class="chart-axis" x="${left - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end">${fmt.format(t.value)}</text>`
    )
    .join("");

  // Dashed, de-emphasised and unfilled: this segment is a forecast, not data.
  // The dot marks the arrival at position 0, so it is only drawn when the line
  // actually gets there — clipped at the edge, it would mark nothing.
  const projectionMark = projection
    ? `<path class="chart-projection" d="M${last.x.toFixed(1)},${last.y.toFixed(1)} L${projection.x.toFixed(1)},${projection.y.toFixed(1)}" />` +
      (projection.clipped
        ? ""
        : `<circle class="chart-target" cx="${projection.x.toFixed(1)}" cy="${projection.y.toFixed(1)}" r="3.5" />`)
    : "";

  const dateLabels = dateMarks
    .map(
      (m) =>
        `<text class="chart-axis" x="${m.at.toFixed(1)}" y="${h - 8}" text-anchor="${m.anchor}">${dateFmt.format(m.date)}</text>`
    )
    .join("");

  const dots = model.showDots
    ? points
        .slice(0, -1)
        .map(
          (p) => `<circle class="chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" />`
        )
        .join("")
    : "";

  const projectionLabel = !projection
    ? ""
    : projection.clipped
      ? ` Projection en pointillés vers la position 0, atteinte le ${proseDateFmt.format(projection.target)}, au-delà du bord droit du graphique.`
      : ` Projection en pointillés jusqu'à la position 0 le ${proseDateFmt.format(projection.target)}.`;

  el.innerHTML = `
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" data-series="position"></span>Votre position<strong>#${fmt.format(end.position)}</strong></span>
      <span class="legend-item"><span class="legend-dot" data-series="total"></span>Taille de la file<strong>${fmt.format(model.totalPoints[model.totalPoints.length - 1].total)}</strong></span>
    </div>
    <div class="chart-plot-wrap">
    <svg class="chart-plot" viewBox="0 0 ${w} ${h}" role="img" tabindex="0"
      aria-label="Deux courbes du ${dateFmt.format(model.startDate)} au ${dateFmt.format(model.lastDate)} : votre position, de ${fmt.format(points[0].position)} à ${fmt.format(end.position)}, et la taille de la file, de ${fmt.format(model.totalPoints[0].total)} à ${fmt.format(model.totalPoints[model.totalPoints.length - 1].total)}.${projectionLabel} Données détaillées dans le tableau sous le graphique.">
      <defs>
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop class="chart-area-from" offset="0%" />
          <stop class="chart-area-to" offset="100%" />
        </linearGradient>
      </defs>
      <g class="chart-grid">${grid}</g>
      <path class="chart-fill" d="${area}" />
      ${projectionMark}
      <path class="chart-total-line" d="${totalLine}" />
      <path class="chart-line" d="${line}" />
      ${dots}
      <line class="chart-crosshair" y1="${top}" y2="${top + plotH}" />
      <circle class="chart-cursor" r="4.5" />
      <circle class="chart-end" cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="4.5" />
      <text class="chart-end-label" x="${end.labelX.toFixed(1)}" y="${end.labelY.toFixed(1)}" text-anchor="${end.labelLeft ? "end" : "start"}">#${fmt.format(end.position)}</text>
      ${dateLabels}
      <rect class="chart-hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" />
    </svg>
    <div class="chart-tooltip" hidden><span class="tt-date"></span><strong class="tt-value"></strong><span class="tt-meta"></span></div>
    </div>
    ${barStrip(model)}
  `;

  wireChartHover(el, history, model);
  renderChartTable(history);
  tableWrap.hidden = false;

  document.getElementById("chart-caption").textContent =
    "Position dans la file — plus bas = plus proche de l'expédition. " +
    "En dessous : les places gagnées par jour, chaque colonne couvrant l'intervalle qu'elle mesure." +
    (!projection
      ? ""
      : projection.clipped
        ? ` En pointillés : projection jusqu'à votre tour, le ${proseDateFmt.format(projection.target)}, hors du graphique.`
        : " En pointillés : projection jusqu'à votre tour.");
}

// Crosshair + tooltip. The readout snaps to the nearest snapshot, so the reader
// aims at a date rather than at a 2px line; arrow keys drive the same readout.
function wireChartHover(el, history, model) {
  const { x, y, geom } = model;
  const svg = el.querySelector(".chart-plot");
  const wrap = el.querySelector(".chart-plot-wrap");
  const columns = [...el.querySelectorAll(".bar")];
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
    // The column for this relevé is the same reading as the crosshair, so it
    // lights up with it rather than carrying a second hover of its own.
    columns.forEach((rect, c) => rect.classList.toggle("is-active", c === i - 1));

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
      x(i) / geom.w < 0.5 ? `${wrap.clientWidth - half - 4}px` : `${half + 4}px`;
  }

  function hide() {
    active = null;
    svg.classList.remove("is-active");
    for (const rect of columns) rect.classList.remove("is-active");
    tooltip.hidden = true;
  }

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const viewX = ((clientX - rect.left) / rect.width) * geom.w;
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

    // The row covers the interval since the previous relevé, so a skipped day has
    // to show here too — the strip encodes it as width, and this table is what
    // stands in for the strip when the figures are read rather than looked at.
    const span = previous && previous.days > 1 ? ` (${previous.days} j)` : "";

    for (const value of [
      dateFmt.format(parseDay(entry.date)) + span,
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

// parseHistory is the same gate the scraper writes through, so a file that would
// render as NaN on every card is rejected here instead. Without it, an HTTP error
// page or a half-written file read as "no data yet" — or worse, as data.
async function loadHistory() {
  const res = await fetch("data/history.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`data/history.json: HTTP ${res.status}`);
  return parseHistory(await res.text());
}

async function main() {
  document.getElementById("order-number").textContent = ORDER_NUMBER;

  let history;
  try {
    history = await loadHistory();
  } catch (err) {
    // An unreadable file is not an empty one, and saying so is the difference
    // between "come back tomorrow" and "something is broken, go look".
    console.error(err);
    const el = document.createElement("p");
    el.className = "empty-state";
    el.textContent =
      "Données de suivi illisibles ou inaccessibles. Le détail est dans la console.";
    document.getElementById("summary").replaceChildren(el);
    return;
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

  // Same UTC convention as the scraper, so "today" means the same day on both sides.
  renderStale(history, new Date().toISOString().slice(0, 10));

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
