// Shared between the front end and the scraper, so the order number lives in one
// place. The workflow still passes ORDER_NUMBER through env: it cannot import.

export const ORDER_NUMBER = "51230";

// Window used to estimate how fast the queue is moving. Counted in snapshots,
// not calendar days — see shippingEstimate.
export const RATE_WINDOW_DAYS = 7;

// A snapshot older than this many days means the daily workflow has been failing
// and the figures on screen are no longer current.
export const STALE_AFTER_DAYS = 2;
