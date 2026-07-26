# TRMNL Queue Tracker

Daily tracking of your position in the TRMNL queue (order #51230), with history
and progress.

## How it works

- [`scripts/scrape.mjs`](scripts/scrape.mjs) replays the 3 requests a real
  browser makes against `trmnl.com/order-tracker` (the page only contains the
  position after a form submit triggered by client-side JS — a plain GET is not
  enough). The result is appended to / updated in
  [`data/history.json`](data/history.json), one entry per day.
- A GitHub Actions workflow ([`.github/workflows/track.yml`](.github/workflows/track.yml))
  runs that script every day at 07:00 UTC and commits the updated file.
- [`index.html`](index.html) is a small web app (PWA) that reads
  `data/history.json` and shows: current position, queue size, places gained/lost
  since the previous snapshot, orders added to the queue, an estimated shipping
  date and a progress chart. Its UI is in French. It validates the file through
  the same `parseHistory` gate the scraper writes through, so an HTTP error page
  or a half-written file says so instead of rendering `NaN` on every card.

No server to run: everything is static and can be hosted for free on GitHub
Pages.

## How the numbers are derived

TRMNL publishes the **current** queue size (`in a queue of N orders`), not a
running total: it shrinks as soon as more orders ship than come in. Comparing two
totals therefore yields the net balance (added − shipped), which can be negative,
rather than the orders added. The app reconstructs the real figures from the two
series:

- **places gained** = `position(previous) − position(current)` — the orders that
  left the queue ahead of us (it is FIFO).
- **orders added** = `queue delta + places gained`.
- **estimated shipping date** = `snapshot date + position / rate`, where the rate
  is the least-squares slope of position against date over the last 7 snapshots
  (window configurable through `RATE_WINDOW_DAYS` in
  [`lib/config.js`](lib/config.js)). A sliding window rather than the average
  since day one, so the estimate stays honest if the shipping cadence changes,
  and a fit rather than the difference between the two ends of that window, which
  gave the snapshots in between no vote and let a single noisy relevé move the
  date by weeks. Note the window counts snapshots, not calendar days: when the
  workflow skips a day it covers the same 7 points spread over more time, and the
  reported span reflects the real elapsed days.
- **the range around that date** comes from the standard error of the fitted
  slope: one standard error either side of the rate, turned back into dates. It
  needs three snapshots to exist at all — on two points the fit is exact and the
  uncertainty is unknown, not zero — and its late bound disappears when the slow
  end of the range allows a stalled queue, because "never" is not a date. The
  headline date is a single day computed from a fitted line; the range is what
  keeps it from reading as a promise.

The arithmetic lives in [`lib/`](lib/) rather than in the page, so it can be
tested without a browser:

| Module | Responsibility |
| --- | --- |
| [`lib/domain.js`](lib/domain.js) | queue arithmetic: movement, shipping estimate, day maths |
| [`lib/chart-model.js`](lib/chart-model.js) | chart geometry as plain numbers; `app.js` is a template over it |
| [`lib/history.js`](lib/history.js) | everything that may read or write `history.json` |
| [`lib/tracker.js`](lib/tracker.js) | the four requests and regexes that talk to trmnl.com |
| [`lib/config.js`](lib/config.js) | order number and tuning constants |

## Deployment (5 minutes)

1. Create a GitHub repository (public or private) and push this folder to it:

   ```bash
   cd ~/dev/trmnl-tracker
   git init
   git add -A
   git commit -m "chore: initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-user>/trmnl-tracker.git
   git push -u origin main
   ```

2. In the repository settings (**Settings → Pages**), pick **Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. In **Settings → Actions → General → Workflow permissions**, select
   **Read and write permissions** (required for the workflow to commit
   `data/history.json`).
4. The app will be available at `https://<your-user>.github.io/trmnl-tracker/`.
   Open that link on your phone, then **Share → Add to Home Screen** (Safari) to
   install it as a real app. The home-screen icon is `icon-180.png`: iOS ignores
   an SVG `apple-touch-icon` and substitutes a screenshot of the page, so both
   PNGs are committed rather than generated at deploy time.
5. The workflow runs automatically every day. To take a snapshot right away
   without waiting: **Actions** tab → *Track queue position* → **Run workflow**.

## When it breaks

The scraper separates the two ways trmnl.com can let it down, because they call
for opposite responses:

- **a bad minute** — a dropped connection, a 429, a 5xx — is retried three times
  with an exponential backoff. The run happens once a day, so waiting a few
  seconds is always better than losing a snapshot to a blip.
- **a reworded page** answers 200 with markup the regexes no longer match. That
  one is not retried: it fails the run, and `validateSnapshot` is there for the
  subtler version where a half-matching regex yields a plausible-looking number.

Either way, a failed run writes nothing: `data/history.json` keeps whatever it
had. The workflow then opens an issue labelled `tracker-failure` (or comments on
the open one, so a week of failures is one thread), and the app shows a banner
once the newest snapshot is more than `STALE_AFTER_DAYS` old rather than
presenting a stale position as current.

One failure mode has no alarm: GitHub disables scheduled workflows on public
repositories after 60 days without repository activity, and it is not documented
whether the workflow's own daily commit resets that clock. A disabled workflow
does not fail, so no issue is opened — the staleness banner in the app is what
catches it. If the tracking ever stops quietly, check the **Actions** tab first.

## Tracking a different order

Edit `ORDER_NUMBER` in [`lib/config.js`](lib/config.js) and in
[`.github/workflows/track.yml`](.github/workflows/track.yml) (the workflow passes
it through `env:`, so it cannot import the constant).

## Running locally

```bash
npm ci                        # dev dependencies (test runner only)
node scripts/scrape.mjs       # updates data/history.json
python3 -m http.server 8080   # then open http://localhost:8080
```

`app.js` is an ES module, so the page has to be served over HTTP — opening
`index.html` from the filesystem will not work.

## Tests

```bash
npm test                          # vitest run
npm run test:watch
TZ=Pacific/Auckland npm test      # what CI also runs
```

The suite covers the two places where a bug is silent and expensive, and
deliberately stops there:

- **the queue arithmetic**, because no one can tell a correct "+6 orders added"
  from a wrong one by looking at the page;
- **the write path**, because `data/history.json` is the whole datastore and the
  daily workflow commits and pushes whatever lands in it.

Left out on purpose: `Intl` output (ICU data shifts between Node versions, so
asserting on `"25 juil."` tests the platform, not us), the exact SVG markup, CSS,
and any request to the real trmnl.com. The suite runs in two timezones because
dates are UTC days and every label is formatted in `fr-FR`.

No test can detect the day TRMNL rewords its tracker page — that is what
`validateSnapshot` is for: it refuses to write a snapshot that jumped
implausibly, so a broken scrape fails the workflow instead of committing garbage.
If the daily run stops succeeding, the page shows a banner rather than presenting
a stale position as current.
