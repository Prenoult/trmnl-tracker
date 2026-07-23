// Scrapes the public TRMNL order-tracker queue position for one order number
// and appends/updates today's snapshot in data/history.json.
//
// The tracker page renders its result via a Stimulus-driven Turbo form submit
// (see submit_on_connect_controller on trmnl.com), so a plain GET of the page
// never contains the queue text. We replay the same three requests a real
// browser makes: GET the page for a session cookie + CSRF token, POST the
// order lookup form, then GET the turbo-frame status endpoint the response
// points to.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ORDER_NUMBER = process.env.ORDER_NUMBER || "51230";
const HISTORY_PATH = path.join(import.meta.dirname, "..", "data", "history.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function mergeCookies(jar, response) {
  const next = new Map(jar);
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    next.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return next;
}

function cookieHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchQueueStatus(orderNumber) {
  let jar = new Map();
  const trackerUrl = `https://trmnl.com/order-tracker?order_number=${orderNumber}`;

  const pageRes = await fetch(trackerUrl, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  jar = mergeCookies(jar, pageRes);
  const pageHtml = await pageRes.text();

  const csrf = pageHtml.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error("Could not find CSRF token on tracker page");

  const postRes = await fetch("https://trmnl.com/order_trackers", {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      Accept: "text/html, application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: trackerUrl,
    },
    body: new URLSearchParams({
      authenticity_token: csrf,
      "order_trackers[order_number]": orderNumber,
    }),
  });
  jar = mergeCookies(jar, postRes);
  const location = postRes.headers.get("location") || trackerUrl;

  const resultRes = await fetch(location, {
    headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(jar) },
  });
  jar = mergeCookies(jar, resultRes);
  const resultHtml = await resultRes.text();

  const token = resultHtml.match(/order_trackers\/status\?token=([a-f0-9]+)/)?.[1];
  if (!token) throw new Error("Could not find status token — order number may be invalid");

  // The status frame can briefly poll ("checking...") before settling; retry a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    const statusRes = await fetch(`https://trmnl.com/order_trackers/status?token=${token}`, {
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(jar) },
    });
    const statusHtml = await statusRes.text();
    const match = statusHtml.match(/You are #([\d,]+) in a queue of ([\d,]+) orders/);
    if (match) {
      return {
        position: Number(match[1].replace(/,/g, "")),
        total: Number(match[2].replace(/,/g, "")),
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Status frame never returned a queue position (order shipped?)");
}

async function main() {
  const { position, total } = await fetchQueueStatus(ORDER_NUMBER);
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  let history = [];
  try {
    history = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
  } catch {
    // no history yet
  }

  const todayIndex = history.findIndex((h) => h.date === today);
  const entry = { date: today, position, total };
  if (todayIndex === -1) history.push(entry);
  else history[todayIndex] = entry;

  history.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");

  console.log(`[${today}] #${position} / ${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
