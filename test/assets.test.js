// app.js is an ES module now, so the service worker has to precache every file it
// imports — a cached page that then fails an import is a blank screen. Nothing in
// development catches this: there, every file comes off the network.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

// Relative src/href targets only: absolute URLs and in-page anchors are not ours
// to cache.
function htmlRefs(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref));
}

// Walks the static import graph the browser will walk.
function importGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const dir = path.posix.dirname(file);
    for (const m of read(file).matchAll(/^\s*import\s[^;]*?from\s+["'](\.[^"']+)["']/gm)) {
      queue.push(path.posix.normalize(path.posix.join(dir, m[1])));
    }
  }
  return seen;
}

const assets = (() => {
  const block = read("sw.js").match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!block) throw new Error("could not find the ASSETS array in sw.js");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
})();

describe("service worker precache list", () => {
  const graph = importGraph("app.js");

  it("finds the module graph it is supposed to be checking", () => {
    // A regex that silently matched nothing would make every test below vacuous.
    expect(graph.size).toBeGreaterThan(1);
    expect(graph).toContain("lib/domain.js");
  });

  it.each([...graph])("covers %s, reachable from app.js", (file) => {
    expect(assets).toContain(file);
  });

  it.each(htmlRefs(read("index.html")))("covers %s, referenced by index.html", (ref) => {
    expect(assets).toContain(ref);
  });

  it.each(JSON.parse(read("manifest.json")).icons.map((icon) => icon.src))(
    "covers %s, declared in the manifest",
    (src) => {
      expect(assets).toContain(src);
    }
  );

  it("lists only files that exist", () => {
    const missing = assets.filter((a) => a !== "./" && !existsSync(path.join(ROOT, a)));
    expect(missing).toEqual([]);
  });

  // Nothing else catches this: an SVG apple-touch-icon is not an error, iOS just
  // ignores the tag and puts a screenshot of the page on the home screen — and
  // the README tells you to install the app that way.
  it("declares an apple-touch-icon iOS will actually use", () => {
    const tag = read("index.html").match(/<link rel="apple-touch-icon"[^>]*>/)?.[0];
    expect(tag).toBeDefined();

    const href = tag.match(/href="([^"]+)"/)[1];
    expect(href).toMatch(/\.png$/);

    // PNG magic, then the IHDR width and height as big-endian 32-bit ints.
    const bytes = readFileSync(path.join(ROOT, href));
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(180);
    expect(bytes.readUInt32BE(20)).toBe(180);
    expect(tag).toContain('sizes="180x180"');
  });

  it("does not ship the scraper to the browser", () => {
    // lib/tracker.js is Node-only: it is reachable from scripts/scrape.mjs, not
    // from app.js, and has no business in the front-end cache.
    expect(graph).not.toContain("lib/tracker.js");
    expect(assets).not.toContain("lib/tracker.js");
  });
});
