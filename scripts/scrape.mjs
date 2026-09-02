// Scrapes the public TRMNL order-tracker queue position for one order number and
// appends/updates today's snapshot in data/history.json.
//
// This script is only the I/O shell: the request sequence lives in lib/tracker.js
// and every rule about what may enter the file in lib/history.js.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { ORDER_NUMBER } from "../lib/config.js";
import { parseHistory, validateSnapshot, upsertSnapshot } from "../lib/history.js";
import { parseStatus } from "../lib/status.js";
import { fetchQueueStatus } from "../lib/tracker.js";

const orderNumber = process.env.ORDER_NUMBER || ORDER_NUMBER;
const HISTORY_PATH = path.join(import.meta.dirname, "..", "data", "history.json");
const STATUS_PATH = path.join(import.meta.dirname, "..", "data", "status.json");

// A missing file is the first run. An unreadable one is a failure: swallowing it
// would rewrite the file with a single entry, and the workflow would commit and
// push that — destroying the series. Read before scraping so we fail fast.
async function readHistory() {
  try {
    return parseHistory(await readFile(HISTORY_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// A missing file means not shipped yet — the ordinary case for as long as the
// order is still in the queue.
async function readStatus() {
  try {
    return parseStatus(await readFile(STATUS_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const history = await readHistory();
  const result = await fetchQueueStatus(orderNumber);
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

  // Once shipped there is no queue position left to record — history.json keeps
  // whatever its last entry was, permanently, and status.json is the only thing
  // that changes, once, from here on.
  if (result.shipped) {
    const existing = await readStatus();
    if (existing) {
      console.log(`Already shipped as of ${existing.shippedDate}; nothing to do.`);
      return;
    }
    await mkdir(path.dirname(STATUS_PATH), { recursive: true });
    await writeFile(STATUS_PATH, JSON.stringify({ shippedDate: today }, null, 2) + "\n");
    console.log(`[${today}] shipped`);
    return;
  }

  const { position, total } = result;

  // Compare against the last *other* day: re-running today would otherwise
  // measure today's correction against itself.
  const previous = history.filter((h) => h.date !== today).at(-1) ?? null;
  const entry = validateSnapshot({ date: today, position, total }, previous);

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(upsertSnapshot(history, entry), null, 2) + "\n");

  console.log(`[${today}] #${position} / ${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
