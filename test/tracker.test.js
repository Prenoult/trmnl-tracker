// The scraper's contract with trmnl.com.
//
// The fixtures in test/fixtures are synthetic: they reproduce the markup shapes
// the parsers depend on, not a byte-for-byte capture of the live site. That is the
// honest limit of these tests — they prove the parsers and the request sequence
// are self-consistent, and they will keep passing on the day TRMNL rewords its
// page. That day is caught by validateSnapshot refusing to write, not here.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  REQUEST_ATTEMPTS,
  STATUS_ATTEMPTS,
  cookieHeader,
  fetchQueueStatus,
  mergeCookies,
  parseCsrfToken,
  parseQueueStatus,
  parseStatusToken,
} from "../lib/tracker.js";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const trackerPage = fixture("tracker-page.html");
const resultPage = fixture("result-page.html");
const statusQueue = fixture("status-queue.html");
const statusChecking = fixture("status-checking.html");

const CSRF = "Xq7pLm3nRt9vBc2wYh5jKd8sFa1gZe4u";
const TOKEN = "4f3a9c1e8b7d206f5a4e3c2b1d0f9e8a";

// Minimal stand-in for a fetch Response: only the three things lib/tracker.js
// reads. A real response always carries a status, so the default is 200 rather
// than absent.
function fakeResponse(body, { cookies = [], location = null, status = 200 } = {}) {
  return {
    status,
    headers: {
      getSetCookie: () => cookies,
      get: (name) => (name.toLowerCase() === "location" ? location : null),
    },
    text: async () => body,
  };
}

describe("parseCsrfToken", () => {
  it("reads the token out of the tracker page", () => {
    expect(parseCsrfToken(trackerPage)).toBe(CSRF);
  });

  it("throws when the meta tag is gone", () => {
    expect(() => parseCsrfToken("<html><head></head></html>")).toThrow(/CSRF token/);
  });
});

describe("parseStatusToken", () => {
  it("reads the turbo-frame token out of the result page", () => {
    expect(parseStatusToken(resultPage)).toBe(TOKEN);
  });

  it("throws when the frame is absent, which is how an unknown order looks", () => {
    expect(() => parseStatusToken(trackerPage)).toThrow(/order number may be invalid/);
  });

  it("ignores a non-hex token rather than passing junk down the chain", () => {
    expect(() => parseStatusToken('src="/order_trackers/status?token=NOT-HEX"')).toThrow();
  });
});

describe("parseQueueStatus", () => {
  it("strips the thousands separators", () => {
    expect(parseQueueStatus(statusQueue)).toEqual({ position: 1316, total: 1438 });
  });

  it("reads numbers with no separator", () => {
    expect(parseQueueStatus("You are #7 in a queue of 42 orders")).toEqual({
      position: 7,
      total: 42,
    });
  });

  // null means "not ready yet", which is what drives the retry loop. Anything
  // that threw here would turn a slow frame into a failed run.
  it("returns null while the frame is still checking", () => {
    expect(parseQueueStatus(statusChecking)).toBeNull();
  });

  it("returns null once the order has shipped and the sentence is gone", () => {
    expect(parseQueueStatus("<p>Your order has shipped!</p>")).toBeNull();
  });
});

describe("mergeCookies", () => {
  // Real Headers here, because getSetCookie() is the part of the platform this
  // code leans on.
  const withCookies = (...lines) => {
    const headers = new Headers();
    for (const line of lines) headers.append("set-cookie", line);
    return { headers };
  };

  it("keeps only the name and value, dropping the attributes", () => {
    const jar = mergeCookies(new Map(), withCookies("_session=abc123; Path=/; HttpOnly; SameSite=Lax"));
    expect(jar.get("_session")).toBe("abc123");
    expect(cookieHeader(jar)).toBe("_session=abc123");
  });

  it("merges a second response into the existing jar", () => {
    const first = mergeCookies(new Map(), withCookies("_session=abc123; Path=/"));
    const second = mergeCookies(first, withCookies("tracker=xyz; Path=/"));
    expect(cookieHeader(second)).toBe("_session=abc123; tracker=xyz");
  });

  it("lets a later response replace a cookie value", () => {
    const first = mergeCookies(new Map(), withCookies("_session=old; Path=/"));
    const second = mergeCookies(first, withCookies("_session=new; Path=/"));
    expect(second.size).toBe(1);
    expect(second.get("_session")).toBe("new");
  });

  it("preserves a base64 value containing '='", () => {
    const jar = mergeCookies(new Map(), withCookies("_session=YWJjMTIz==; Path=/"));
    expect(jar.get("_session")).toBe("YWJjMTIz==");
  });

  it("skips a malformed line instead of inventing a truncated cookie name", () => {
    const jar = mergeCookies(new Map(), withCookies("garbage; Path=/", "=novalue; Path=/"));
    expect(jar.size).toBe(0);
  });

  it("does not mutate the jar it was given", () => {
    const jar = new Map();
    mergeCookies(jar, withCookies("_session=abc; Path=/"));
    expect(jar.size).toBe(0);
  });
});

describe("fetchQueueStatus", () => {
  // Drives the four-request flow without a network. Records every call so the
  // sequence itself is asserted, not just the final value.
  function stub({ statusBodies = [statusQueue], location = "https://trmnl.com/order_trackers/9" } = {}) {
    const calls = [];
    const statuses = [...statusBodies];
    let trackerHits = 0;
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/order-tracker?")) {
        trackerHits += 1;
        // Once the session is set, the same URL re-renders with the status frame.
        // That is what the missing-Location fallback relies on.
        return fakeResponse(trackerHits === 1 ? trackerPage : resultPage, {
          cookies: ["_session=abc123; Path=/; HttpOnly"],
        });
      }
      if (url.endsWith("/order_trackers")) {
        return fakeResponse("", { cookies: ["tracker=xyz; Path=/"], location });
      }
      if (url.includes("/order_trackers/status?token=")) {
        return fakeResponse(statuses.length > 1 ? statuses.shift() : statuses[0]);
      }
      return fakeResponse(resultPage);
    };
    return { calls, fetchImpl, sleep: async () => {} };
  }

  it("returns the queue position after the full flow", async () => {
    const { fetchImpl, sleep } = stub();
    await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).resolves.toEqual({
      position: 1316,
      total: 1438,
    });
  });

  it("makes the four requests in order", async () => {
    const { calls, fetchImpl, sleep } = stub();
    await fetchQueueStatus("51230", { fetchImpl, sleep });
    expect(calls.map((c) => c.url)).toEqual([
      "https://trmnl.com/order-tracker?order_number=51230",
      "https://trmnl.com/order_trackers",
      "https://trmnl.com/order_trackers/9",
      `https://trmnl.com/order_trackers/status?token=${TOKEN}`,
    ]);
  });

  it("posts the scraped CSRF token and the order number", async () => {
    const { calls, fetchImpl, sleep } = stub();
    await fetchQueueStatus("51230", { fetchImpl, sleep });
    const post = calls[1];
    expect(post.options.method).toBe("POST");
    // Manual redirect: the Location header is what carries the result page.
    expect(post.options.redirect).toBe("manual");
    expect(post.options.body.get("authenticity_token")).toBe(CSRF);
    expect(post.options.body.get("order_trackers[order_number]")).toBe("51230");
  });

  it("carries the session cookie forward and accumulates new ones", async () => {
    const { calls, fetchImpl, sleep } = stub();
    await fetchQueueStatus("51230", { fetchImpl, sleep });
    expect(calls[1].options.headers.Cookie).toBe("_session=abc123");
    // The POST handed back a second cookie; both are sent from then on.
    expect(calls[2].options.headers.Cookie).toBe("_session=abc123; tracker=xyz");
    expect(calls[3].options.headers.Cookie).toBe("_session=abc123; tracker=xyz");
  });

  it("falls back to the tracker URL when the POST returns no Location", async () => {
    const { calls, fetchImpl, sleep } = stub({ location: null });
    await fetchQueueStatus("51230", { fetchImpl, sleep });
    expect(calls[2].url).toBe("https://trmnl.com/order-tracker?order_number=51230");
  });

  it("retries a frame that is still checking, then succeeds", async () => {
    const { calls, fetchImpl, sleep } = stub({
      statusBodies: [statusChecking, statusChecking, statusQueue],
    });
    await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).resolves.toEqual({
      position: 1316,
      total: 1438,
    });
    const statusCalls = calls.filter((c) => c.url.includes("status?token="));
    expect(statusCalls).toHaveLength(3);
  });

  it("gives up after the attempt budget rather than looping forever", async () => {
    const { calls, fetchImpl, sleep } = stub({ statusBodies: [statusChecking] });
    await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).rejects.toThrow(
      /never returned a queue position/
    );
    expect(calls.filter((c) => c.url.includes("status?token="))).toHaveLength(STATUS_ATTEMPTS);
  });

  // The distinction the run depends on: a bad minute at trmnl.com is worth
  // waiting out, a reworded page is not, and before the status was checked both
  // arrived as "Could not find CSRF token".
  describe("transient failures", () => {
    // Answers with the given statuses in order, then serves the real flow.
    function flaky(statuses) {
      const base = stub();
      const queue = [...statuses];
      const waits = [];
      return {
        ...base,
        waits,
        sleep: async (ms) => void waits.push(ms),
        fetchImpl: async (url, options) => {
          const status = queue.shift();
          if (status !== undefined) return fakeResponse("<html>error</html>", { status });
          return base.fetchImpl(url, options);
        },
      };
    }

    it("waits out a 503 and completes on the retry", async () => {
      const { fetchImpl, sleep, waits } = flaky([503]);
      await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).resolves.toEqual({
        position: 1316,
        total: 1438,
      });
      expect(waits[0]).toBeGreaterThan(0);
    });

    it("waits out a rate limit", async () => {
      const { fetchImpl, sleep } = flaky([429]);
      await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).resolves.toMatchObject({
        position: 1316,
      });
    });

    it("backs off further on each attempt", async () => {
      const { fetchImpl, sleep, waits } = flaky([503, 503]);
      await fetchQueueStatus("51230", { fetchImpl, sleep });
      expect(waits[1]).toBeGreaterThan(waits[0]);
    });

    it("gives up after the attempt budget, naming the status", async () => {
      const { calls, fetchImpl, sleep } = flaky(Array(REQUEST_ATTEMPTS).fill(503));
      await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).rejects.toThrow(
        /tracker page: trmnl\.com answered HTTP 503/
      );
      expect(calls).toHaveLength(0); // never reached the real flow
    });

    it("does not retry a 404, which will not fix itself", async () => {
      const { fetchImpl, sleep, waits } = flaky([404, 404, 404]);
      await expect(fetchQueueStatus("51230", { fetchImpl, sleep })).rejects.toThrow(/HTTP 404/);
      expect(waits).toEqual([]);
    });

    it("retries a dropped connection, which has no status to inspect", async () => {
      const base = stub();
      let thrown = false;
      const fetchImpl = async (url, options) => {
        if (!thrown) {
          thrown = true;
          throw new TypeError("fetch failed");
        }
        return base.fetchImpl(url, options);
      };
      await expect(
        fetchQueueStatus("51230", { fetchImpl, sleep: async () => {} })
      ).resolves.toMatchObject({ position: 1316 });
    });

    it("reports a network failure as the request failing, not as a missing token", async () => {
      const fetchImpl = async () => {
        throw new TypeError("fetch failed");
      };
      await expect(
        fetchQueueStatus("51230", { fetchImpl, sleep: async () => {} })
      ).rejects.toThrow(/tracker page: request failed \(fetch failed\)/);
    });

    it("still fails hard on a 200 whose markup lost the token", async () => {
      // The failure the retries must not paper over: the page came back fine and
      // no longer says what we parse. That has to stop the workflow.
      const fetchImpl = async () => fakeResponse("<html><head></head></html>");
      await expect(
        fetchQueueStatus("51230", { fetchImpl, sleep: async () => {} })
      ).rejects.toThrow(/CSRF token/);
    });
  });

  it("surfaces a missing CSRF token without making the POST", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return fakeResponse("<html><head></head></html>");
    };
    await expect(fetchQueueStatus("51230", { fetchImpl, sleep: async () => {} })).rejects.toThrow(
      /CSRF token/
    );
    expect(calls).toHaveLength(1);
  });
});
