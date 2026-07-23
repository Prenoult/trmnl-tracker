const ORDER_NUMBER = "51230";

const fmt = new Intl.NumberFormat("fr-FR");
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

function setDelta(el, value, { invert = false, suffix = "" } = {}) {
  if (value === null) {
    el.textContent = "–";
    el.className = "delta-value";
    return;
  }
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const sign = value > 0 ? "+" : "";
  el.textContent = `${sign}${fmt.format(value)}${suffix}`;
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

  document.getElementById("position").textContent = `#${fmt.format(latest.position)}`;
  document.getElementById("total").textContent = fmt.format(latest.total);

  setDelta(
    document.getElementById("delta-position"),
    previous ? previous.position - latest.position : null,
    { invert: false }
  );
  setDelta(
    document.getElementById("delta-total"),
    previous ? latest.total - previous.total : null,
    { invert: true }
  );

  renderChart(history);

  const daysTracked = Math.max(
    1,
    Math.round((new Date(latest.date) - new Date(first.date)) / 86400000)
  );
  const totalGain = first.position - latest.position;
  const dailyRate = daysTracked > 0 ? totalGain / daysTracked : 0;
  const summaryEl = document.getElementById("summary");

  if (history.length < 2) {
    summaryEl.innerHTML = `Premier relevé enregistré le ${dateFmt.format(new Date(latest.date))} — la progression s'affichera à partir de demain.`;
  } else {
    let etaLine = "";
    if (dailyRate > 0) {
      const daysLeft = Math.ceil(latest.position / dailyRate);
      etaLine = ` Au rythme actuel (<strong>${dailyRate.toFixed(1)} places/jour</strong>), encore environ <strong>${fmt.format(daysLeft)} jour${daysLeft > 1 ? "s" : ""}</strong> avant votre tour.`;
    }
    summaryEl.innerHTML = `Depuis le ${dateFmt.format(new Date(first.date))}, vous avez gagné <strong>${fmt.format(totalGain)} place${Math.abs(totalGain) > 1 ? "s" : ""}</strong> en <strong>${daysTracked} jour${daysTracked > 1 ? "s" : ""}</strong> de suivi.${etaLine}`;
  }

  const chartCaption = document.getElementById("chart-caption");
  chartCaption.textContent = `${dateFmt.format(new Date(first.date))} → ${dateFmt.format(new Date(latest.date))} · position dans la file (plus bas = plus proche)`;

  const lastUpdated = new Date(latest.date);
  document.getElementById("last-updated").textContent =
    `Dernière mise à jour : ${dateFmt.format(lastUpdated)}`;
}

main();
