# TRMNL Queue Tracker

Daily tracking of your position in the TRMNL queue (order #51230), with history
and progress.

## How it works

- [`scripts/scrape.mjs`](scripts/scrape.mjs) replays the 3 requests a real
  browser makes against `trmnl.com/order-tracker` (the page only contains the
  position after a form submit triggered by client-side JS — a plain GET is not
  enough). The result is appended to / updated in
  [`data/history.json`](data/history.json), one entry per day — until the order
  ships, at which point there is no more position to record and the run instead
  writes [`data/status.json`](data/status.json) (`{ "shippedDate": "…" }`) once
  and stops touching either file again.
- A GitHub Actions workflow ([`.github/workflows/track.yml`](.github/workflows/track.yml))
  runs that script and commits whatever it wrote. It ran on a daily schedule
  while order #51230 was still queued; now that `data/status.json` exists it is
  `workflow_dispatch` only — see [Tracking a different order](#tracking-a-different-order)
  to re-enable the schedule for a new order.
- [`index.html`](index.html) is a small web app (PWA) that reads
  `data/history.json` and shows: current position, queue size, places gained/lost
  since the previous snapshot, orders added to or removed from the queue behind
  us, the queue itself drawn as a lane with our place marked on it, an estimated
  shipping date and a progress chart. Its UI is in French. It validates the file
  through
  the same `parseHistory` gate the scraper writes through, so an HTTP error page
  or a half-written file says so instead of rendering `NaN` on every card. Once
  `data/status.json` exists it shows a "commande expédiée" banner instead of the
  shipping estimate, and leaves the rest of the page as the historical record of
  the wait.

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
- **net orders added** = `queue delta + places gained` — what happened *behind*
  us. It is a net figure and it goes negative: the identity credits every
  departure from the queue to shipping at the front, so an order that leaves from
  behind us (cancelled, refunded, or dropped when TRMNL recounts) arrives here
  with a minus sign. On 28 July the queue fell by 48 while we moved up only 5
  places, which is −43: 43 orders left the queue without ever passing us. The
  page therefore words the direction rather than printing a sign — "43 commandes
  retirées", not "−43 commandes ajoutées".
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
- **the pace comparison** re-runs the same least-squares fit on the *whole*
  series instead of the last `RATE_WINDOW_DAYS` snapshots, and states whether
  the current rate is faster, slower, or close to (within 10%) that whole-series
  rate. A number on its own — "31.5 places/day" — has nothing to be fast or slow
  compared to; this gives it a baseline. It says nothing once the tracked series
  is still shorter than the rolling window itself, since the two fits would then
  be the same window compared to itself.

Under the headline date sits a small calendar page for the month it falls in:
the target date circled, and — where a range exists — every day of it shaded.
"Mercredi 16 septembre 2026" says the date; the grid says which day of the week
that is and how the range sits around it, both faster to read off a page than
parsed back out of "du 13 au 19 septembre". Only the target's own month is
drawn, so a range reaching past its edges is clipped there rather than pulling
in a second month — the same trade-off the chart's own axis makes for the
projection — and the card says so explicitly rather than let the clipped band
pass for the whole story.

The queue lane draws the queue itself rather than the history of it: one rank
axis from the order shipping next, at the left, to the back of the queue at the
right, with our order marked on it. The chart answers *how fast*; this answers
*where*, which the position number alone does not — `#1114` means nothing until
you can see it sitting between the 1113 orders that ship first and the 497 that
arrived after.

- **the comb** is the queue at bucket resolution: the lane holds a fixed number
  of ticks, so one tick is `queue size / ticks` orders, and the caption says how
  many. It is a texture, never a count — the two figures under the lane
  (`position − 1` ahead, `queue size − position` behind) are exact and are what
  the reading rests on. Below one order per tick the ticks stop subdividing and
  a queue of seven draws seven blocks, because a finer comb would claim a
  precision the queue does not have.
- **only the orders ahead carry the accent**, fading from the shipping end
  towards the marker. That segment is the wait, and it is the only part of the
  drawing that has to go away; the orders behind are greyed, on the same
  reasoning that makes the queue-size line thin and unfilled in the chart.
- **the pale marker** is our rank at the first snapshot, on today's axis — both
  are ranks, so they belong on the same scale — with the ground covered since
  drawn between the two. A queue that has since shed enough orders to no longer
  contain that rank puts the ghost at the back of the lane and says so in the
  caption, rather than dropping it silently.

The chart is three panels on one time axis, because the position curve alone
answers neither of the questions the estimate raises:

- **the queue size** is drawn as a second line on the *same* y-axis. Both are
  orders, and a rank never exceeds the queue holding it, so one scale is honest —
  and it has to be, because the reading is the *gap* between the two lines, which
  is the orders sitting behind us. Two y-scales would be a dual axis, and the gap
  would stop meaning anything.
- **the places gained per day** are columns under the curve, on that same x
  mapping. The curve is cumulative, so it smooths exactly what the estimate rests
  on: a relevé that gained one place and one that gained seventy read as much the
  same slope. The strip is the evidence behind the estimate's range.

  Each column spans the interval it measures and its height is the *rate*, so its
  area is the places gained — a histogram over uneven bins. Where every relevé is
  a day apart the rate and the gain are the same number and it reads as a plain
  column chart; where the workflow skipped days, one relevé carries several days
  of movement, and a column the height of a normal one would claim a cadence that
  never happened. A skipped day is now the one thing on the page that is *wider*
  rather than invisible.

  A solid line runs over the columns: the same rolling fit `shippingEstimate`
  uses, recomputed as of every relevé instead of only today's, on the same scale
  as the columns it is smoothing. The columns answer "how uneven was each day";
  the line answers "is the pace itself trending", which no number of columns
  read one at a time can show. It carries no per-point label — the current value
  is already spelled out in the pace badge above the chart — and it draws nothing
  at all until a second relevé gives it something to connect.

Both are direct-labelled — the legend carries each series' current value and the
strip labels its newest column — so nothing needs a hover to be read, which on a
phone means nothing needs a press-and-hold.

The arithmetic lives in [`lib/`](lib/) rather than in the page, so it can be
tested without a browser:

| Module | Responsibility |
| --- | --- |
| [`lib/domain.js`](lib/domain.js) | queue arithmetic: movement, shipping estimate, day maths |
| [`lib/chart-model.js`](lib/chart-model.js) | chart geometry as plain numbers; `app.js` is a template over it |
| [`lib/queue-model.js`](lib/queue-model.js) | queue-lane geometry, same split and for the same reason |
| [`lib/history.js`](lib/history.js) | everything that may read or write `history.json` |
| [`lib/status.js`](lib/status.js) | validates `status.json`, the one-shot shipped flag |
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
5. This copy of the workflow has no `schedule:` trigger — order #51230, the one
   it was tracking, has shipped, so there is nothing left to poll for daily. For
   your own order, add a `schedule:` trigger back to
   [`.github/workflows/track.yml`](.github/workflows/track.yml) (see
   [Tracking a different order](#tracking-a-different-order)) so it runs
   automatically every day. Until then, or to take a snapshot right away:
   **Actions** tab → *Track queue position* → **Run workflow**.

## When it breaks

The scraper separates the two ways trmnl.com can let it down, because they call
for opposite responses:

- **a bad minute** — a dropped connection, a 429, a 5xx — is retried three times
  with an exponential backoff. The run happens once a day, so waiting a few
  seconds is always better than losing a snapshot to a blip.
- **a reworded page** answers 200 with markup the regexes no longer match. That
  one is not retried: it fails the run, and `validateSnapshot` is there for the
  subtler version where a half-matching regex yields a plausible-looking number.

A third shape of 200 response is not a failure at all: `isShipped` in
[`lib/tracker.js`](lib/tracker.js) recognises the page telling us the order has
shipped, before it can be mistaken for a reworded one, and the run writes
`data/status.json` once and exits cleanly — no retry, no issue.

Either of the two real failures above leaves the run writing nothing: `data/history.json` keeps whatever it
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
it through `env:`, so it cannot import the constant). Also delete
`data/status.json` if it exists — it is the previous order's shipped flag, and
its presence would make the app treat the new order as already shipped too — and
add a `schedule:` trigger back to `on:` in the workflow (removed when the
previous order shipped, per [When it breaks](#when-it-breaks)) so the new order
gets tracked automatically again:

```yaml
on:
  schedule:
    - cron: "0 7 * * *" # 07:00 UTC daily
  workflow_dispatch: {}
```

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
