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
  since the previous snapshot, orders added to the queue, a progress chart, and
  an estimate of how many days are left at the current rate. Its UI is in French.

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
   install it as a real app.
5. The workflow runs automatically every day. To take a snapshot right away
   without waiting: **Actions** tab → *Track queue position* → **Run workflow**.

## Tracking a different order

Edit `ORDER_NUMBER` in [`.github/workflows/track.yml`](.github/workflows/track.yml)
and in [`app.js`](app.js) (`const ORDER_NUMBER = "..."`).

## Running locally

```bash
node scripts/scrape.mjs   # updates data/history.json
python3 -m http.server 8080   # then open http://localhost:8080
```
