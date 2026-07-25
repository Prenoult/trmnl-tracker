const ORDER_NUMBER = "51230";

// The UI is French; keep every Intl formatter on one locale.
const LOCALE = "fr-FR";

const fmt = new Intl.NumberFormat(LOCALE);
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });

// Dates in history.json are plain UTC days ("2026-07-25"), so parse them as UTC:
// formatting them in a timezone west of Greenwich would otherwise shift every
// label back by a day.
const parseDay = (s) => new Date(`${s}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
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

function renderChart(history) {
  const el = document.getElementById("chart");
  if (history.length < 2) {
    el.innerHTML = '<p class="empty-state">Revenez demain pour voir la courbe de progression.</p>';
    return;
  }

  const w = 440;
  const h = 160;
  const pad = 8;
  const positions = history.map((p) => p.position);
  const max = Math.max(...positions);
  const min = Math.min(...positions);
  const range = max - min || 1;

  const x = (i) => pad + (i / (history.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);

  const points = history.map((p, i) => `${x(i)},${y(p.position)}`).join(" ");
  const areaPoints = `${x(0)},${h - pad} ${points} ${x(history.length - 1)},${h - pad}`;

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polygon points="${areaPoints}" fill="var(--accent)" opacity="0.12" />
      <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" />
      ${history
        .map(
          (p, i) =>
            `<circle cx="${x(i)}" cy="${y(p.position)}" r="3" fill="var(--accent)"></circle>`
        )
        .join("")}
    </svg>
  `;
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

  renderChart(history);

  const totalGain = first.position - latest.position;
  const totalAdded = history
    .slice(1)
    .reduce((sum, entry, i) => sum + movement(history[i], entry).added, 0);
  const daysTracked = Math.max(1, daysBetween(first.date, latest.date));
  const dailyRate = totalGain / daysTracked;
  const summaryEl = document.getElementById("summary");

  if (history.length < 2) {
    summaryEl.innerHTML = `Premier relevé enregistré le ${dateFmt.format(parseDay(latest.date))} — la progression s'affichera à partir de demain.`;
  } else {
    let etaLine = "";
    if (dailyRate > 0) {
      const daysLeft = Math.ceil(latest.position / dailyRate);
      etaLine = ` Au rythme actuel (<strong>${dailyRate.toFixed(1)} places/jour</strong>), encore environ <strong>${fmt.format(daysLeft)} jour${plural(daysLeft)}</strong> avant votre tour.`;
    }
    summaryEl.innerHTML =
      `Depuis le ${dateFmt.format(parseDay(first.date))}, vous avez gagné ` +
      `<strong>${fmt.format(totalGain)} place${plural(totalGain)}</strong> en ` +
      `<strong>${daysTracked} jour${plural(daysTracked)}</strong> de suivi, pendant que ` +
      `<strong>${fmt.format(totalAdded)} nouvelle${plural(totalAdded)} commande${plural(totalAdded)}</strong> ` +
      `rejoignai${plural(totalAdded, "en")}t la file.` +
      etaLine;
  }

  document.getElementById("chart-caption").textContent =
    `${dateFmt.format(parseDay(first.date))} → ${dateFmt.format(parseDay(latest.date))} · position dans la file (plus bas = plus proche)`;

  document.getElementById("last-updated").textContent =
    `Dernière mise à jour : ${dateFmt.format(parseDay(latest.date))}`;
}

main();
