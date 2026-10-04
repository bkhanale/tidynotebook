# 0193. One function applies a subscription and webhooks feed it

- Status: Accepted
- Date: 2026-10-04

## Context

Reading Paddle on each request ties every request to Paddle. Webhooks alone
leave an account wrong after a lost delivery. Paddle can deliver an event
twice and out of order, and each subscription event carries the whole
subscription. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- One SQL function applies a subscription snapshot. It locks the subscription,
  ignores a snapshot whose Paddle `updated_at` is not newer than the stored
  one, stores the snapshot, and sets the coverage and the limits of every
  account that holds a seat, in one transaction. It then sends a `billing`
  notice to each account whose coverage or limits it changed, including an
  account that lost its seat, through the notice path of record 0125.
- The contract operation `receivePaddleEvent`, at
  `POST /api/billing/paddle-events`, takes each webhook. The handler
  checks the `Paddle-Signature` header against the raw body through the SDK
  before it parses anything, stores the event identifier and ignores one it
  has seen, and calls the function for each `subscription.*` event. It answers
  200 for any other valid event and stores nothing for it.
- An hourly job reads the Paddle events after a stored cursor, applies each
  `subscription.*` event that it lacks, and moves the cursor past every event
  that it read, in the transaction of the last one. The cursor never follows
  the webhooks, so a lost event is never skipped. Paddle keeps events for a
  limited time, so the daily job is the bound when the hourly job stops for
  longer than that.
- A daily job fetches by identifier every subscription that the database
  holds as `active` or `past_due`, then lists every subscription that Paddle
  holds as `active` or `past_due`, and applies each snapshot. A subscription
  that ended in Paddle while the database still covers it is found by the
  first pass.
- Both jobs run under an advisory lock (record 0121) and log each difference
  that they repair.
- An API change of record 0191 applies the subscription that Paddle answers
  through the same function, so the person sees the change at once.
- `pnpm billing:sync` runs both jobs by hand.
- A completed payment for an account that already bills a live subscription
  is a duplicate. The server cancels the new subscription at once, refunds its
  payment in full through the API, and logs the event.

## Consequences

- An outage of Paddle stops no request. A change made in that time arrives
  through a retry of Paddle or through the hourly job.
- An integration test drops a cancellation event, stores a later event, and
  proves that both the hourly and the daily job end the coverage.
- Integration tests feed signed fixture events: a wrong signature changes
  nothing, a repeated event changes nothing, an older snapshot after a newer
  one changes nothing, and the coverage of every seat follows one snapshot.
