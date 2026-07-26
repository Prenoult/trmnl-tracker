// Talks to trmnl.com's public order tracker.
//
// The tracker page renders its result via a Stimulus-driven Turbo form submit
// (see submit_on_connect_controller on trmnl.com), so a plain GET of the page
// never contains the queue text. We replay the same three requests a real
// browser makes: GET the page for a session cookie + CSRF token, POST the order
// lookup form, then GET the turbo-frame status endpoint the response points to.
//
// Every parser here is a regex over someone else's markup. No test can tell us
// the day TRMNL rewords that markup — the parsers throw loudly instead, and the
// caller refuses to write rather than recording a garbage snapshot.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export const STATUS_ATTEMPTS = 5;
export const STATUS_RETRY_MS = 1500;

export function parseCsrfToken(html) {
  const token = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error("Could not find CSRF token on tracker page");
  return token;
}

export function parseStatusToken(html) {
  const token = html.match(/order_trackers\/status\?token=([a-f0-9]+)/)?.[1];
  if (!token) throw new Error("Could not find status token — order number may be invalid");
  return token;
}

// Returns null while the frame is still polling ("checking…"), so the caller can
// tell "not ready yet" from "will never be ready".
export function parseQueueStatus(html) {
  const match = html.match(/You are #([\d,]+) in a queue of ([\d,]+) orders/);
  if (!match) return null;
  return {
    position: Number(match[1].replace(/,/g, "")),
    total: Number(match[2].replace(/,/g, "")),
  };
}

// Just enough cookie jar to carry the session between the four requests: name and
// value only, no Domain/Path/Expires handling, since every request goes to the
// same host in the space of a few seconds.
export function mergeCookies(jar, response) {
  const next = new Map(jar);
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    next.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return next;
}

export function cookieHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

// I/O shell. fetchImpl and sleep are injectable so the request sequence can be
// exercised without a network or a real 7.5s wait.
export async function fetchQueueStatus(
  orderNumber,
  {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = STATUS_ATTEMPTS,
  } = {}
) {
  let jar = new Map();
  const trackerUrl = `https://trmnl.com/order-tracker?order_number=${orderNumber}`;

  const pageRes = await fetchImpl(trackerUrl, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  jar = mergeCookies(jar, pageRes);
  const csrf = parseCsrfToken(await pageRes.text());

  const postRes = await fetchImpl("https://trmnl.com/order_trackers", {
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

  const resultRes = await fetchImpl(location, {
    headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(jar) },
  });
  jar = mergeCookies(jar, resultRes);
  const token = parseStatusToken(await resultRes.text());

  // The status frame can briefly poll ("checking...") before settling.
  for (let attempt = 0; attempt < attempts; attempt++) {
    const statusRes = await fetchImpl(`https://trmnl.com/order_trackers/status?token=${token}`, {
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: cookieHeader(jar) },
    });
    const status = parseQueueStatus(await statusRes.text());
    if (status) return status;
    await sleep(STATUS_RETRY_MS);
  }
  throw new Error("Status frame never returned a queue position (order shipped?)");
}
