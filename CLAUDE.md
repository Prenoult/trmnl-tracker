# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

A static PWA that tracks one order's position in the TRMNL shipping queue, plus a
Node scraper that appends a daily snapshot to `data/history.json`. There is no
server, no build step and no framework: `index.html` loads `app.js` as an ES
module and the browser loads `lib/*.js` directly. GitHub Pages serves the repo
root as-is, so **whatever is committed is what ships**.

The UI is French. Code, comments, commit messages and this file are English.

## Commands

```bash
npm ci                        # devDependencies: vitest only
npm test                      # vitest run — the gate
npm run test:watch
TZ=Pacific/Auckland npm test  # CI runs the suite in this timezone too
npm run scrape                # node scripts/scrape.mjs — hits the real trmnl.com and writes data/history.json
python3 -m http.server 8080   # then http://localhost:8080
```

`app.js` is an ES module, so `file://` will not work — the page must be served
over HTTP. There is no linter or formatter configured; match the surrounding
style (2-space indent, double quotes, semicolons, ~100-column lines).

Do not run `npm run scrape` casually: it performs live requests to trmnl.com and
rewrites the datastore.

## Architecture

```
scripts/scrape.mjs ──> lib/tracker.js  (4 HTTP requests + regexes → {position, total})
        │              lib/history.js  (validate → upsert)
        └────────────> data/history.json   ← the entire datastore, committed by CI
                              │
index.html → app.js ──────────┘  lib/history.js (parseHistory gate, staleness)
                                 lib/domain.js      (queue arithmetic)
                                 lib/chart-model.js (chart geometry as numbers)
```

| File | Responsibility |
| --- | --- |
| `lib/config.js` | `ORDER_NUMBER`, `RATE_WINDOW_DAYS`, `STALE_AFTER_DAYS` |
| `lib/domain.js` | queue arithmetic: `movement`, `shippingEstimate`, UTC day maths. Pure — no DOM, no I/O, no formatting |
| `lib/chart-model.js` | `buildChartModel` returns plain numbers; `app.js` is a template over them |
| `lib/history.js` | everything that may read or write `history.json`: `parseHistory`, `validateSnapshot`, `upsertSnapshot`, `staleness` |
| `lib/tracker.js` | Node-only: the request sequence and regexes against trmnl.com |
| `app.js` | formatting + DOM only. If you are writing arithmetic here, it belongs in `lib/` |
| `sw.js` | offline cache; network-first for `data/history.json`, cache-first for the rest |

`data/history.json` is an array of `{ date: "YYYY-MM-DD", position, total }`,
sorted by date, one entry per UTC day.

## Rules that are easy to break

**Dates are UTC days.** `parseDay` reads `"2026-07-25"` as UTC midnight on
purpose; parsing locally shifts every label back a day west of Greenwich. Never
use `new Date(s)` on a history date, and derive "today" as
`new Date().toISOString().slice(0, 10)` on both sides (scraper and app) so they
agree.

**Arithmetic goes in `lib/`, not in `app.js`.** That split is what makes the
maths testable without a browser, and the tests are the only thing that can tell
a correct "+6 orders added" from a wrong one.

**Never silently recover from an unreadable `history.json`.** `parseHistory`
throws by design. Falling back to `[]` would make the scraper write a one-entry
file over the series, and the workflow would commit and push it. The front end
shows an error state instead of "no data yet".

**Touching `sw.js`? Bump `CACHE`.** Clients keep serving the old bundle
otherwise. Every file in `app.js`'s static import graph must appear in `ASSETS`,
or a cached page dies on a failed import. `lib/tracker.js` must stay *out* of
`ASSETS` — it is Node-only. `test/assets.test.js` enforces all of this, including
that `index.html` refs and manifest icons are cached and that the
`apple-touch-icon` is a real 180×180 PNG (iOS ignores an SVG one and substitutes
a screenshot of the page).

**Queue size is the *current* total, not a running total.** Comparing two totals
gives the net balance, not the orders added. The identity is
`netAdded = queue delta + places gained`, where `gained = prev.position -
curr.position`. `netAdded` is *net* and legitimately negative: it credits every
departure from the queue to shipping at the front, so an order that leaves from
behind the tracked position (cancellation, refund, recount) lands there with a
minus sign. The copy on the page words the direction instead of printing a sign —
"43 commandes retirées", never "−43 commandes ajoutées".

**Changing `ORDER_NUMBER` means two places**: `lib/config.js` and the `env:` block
in `.github/workflows/track.yml` (the workflow cannot import the constant).

**No `innerHTML` for scraped or computed values in interactive paths.** The hover
readout and the table build cells with `textContent`; keep it that way.

## Tests

`test/` mirrors `lib/` (`domain`, `history`, `chart-model`, `tracker`) plus
`assets.test.js` for the service-worker precache list. Fixtures in
`test/fixtures/` are *synthetic* markup shapes, not captures of the live site.

The suite deliberately covers the queue arithmetic (silent, expensive bugs) and
the write path (the datastore gets pushed automatically), and deliberately skips:
`Intl` output (ICU data shifts between Node versions), exact SVG markup, CSS, and
any request to the real trmnl.com. Chart tests assert on the model's numbers —
their real target is a `NaN` reaching an SVG `d` attribute, which makes a curve
vanish with no error anywhere.

No test can catch the day TRMNL rewords its page. `validateSnapshot` is the
defence: a snapshot has to break both an absolute (100) and a relative (50%) jump
bound to be rejected, so the run fails instead of committing garbage.

Add a test alongside any change to `lib/`. If a change is genuinely untestable
(styling, copy), say so rather than adding a test that asserts the platform.

## CI and the daily workflow

- `.github/workflows/ci.yml` — on every push and PR, Node 22, matrix
  `TZ ∈ {UTC, Pacific/Auckland}`. Both must pass.
- `.github/workflows/track.yml` — daily at 07:00 UTC (plus `workflow_dispatch`),
  concurrency-grouped, needs `contents: write` and `issues: write`. It runs the
  scraper, commits `data/history.json`, and on failure opens (or comments on) one
  issue labelled `tracker-failure`. A failed run writes nothing.

The `Update queue history` commits on `main` come from the bot. Don't hand-edit
`data/history.json`; if you must, keep it sorted, one entry per date, and valid
against `parseHistory`.

## Conventions

**Commits** follow Conventional Commits with an optional scope
(`fix(chart): …`, `feat(eta): …`, `refactor:`, `docs:`, `test:`, `style:`). The
subject is lowercase prose, not a noun phrase. Bodies are the norm and explain
*why* — what was wrong before, what the change trades away — in full sentences.
Read `git log` before writing one; the house style is distinctive.

**Comments** in this codebase justify decisions rather than restate code. Most
non-obvious constant or branch carries a note on the failure it prevents. When
you change such code, update the reasoning with it — a stale rationale is worse
than none.

**CSS** uses custom properties on `:root` with a `prefers-color-scheme: dark`
block. Series colours were validated as a categorical palette (lightness band,
chroma floor, CVD separation, 3:1 contrast) separately for each surface — if you
change a colour, re-validate rather than lightening the light-mode value.
Tabular figures are for columns of numbers (table, axis ticks, chart labels), not
for the hero values.

**Charts**: position and queue size share one y-axis on purpose — the *gap*
between the lines is the meaning, and a dual axis would destroy it. The gains
strip is a histogram over uneven bins: column width is the interval, height is
the rate, area is the places gained, so a skipped day reads as wide-and-low
rather than as a false spike.

## Working on this repo

- Development happens on feature branches; `main` is what GitHub Pages serves.
- `README.md` documents the derivation of every figure on the page. If you change
  how a number is computed, update it in the same commit.
- Prefer changing `lib/` + a test over changing `app.js`.
