# 0196. The billing service mirrors Paddle into the account controls

- Status: Accepted
- Date: 2026-10-04

## Context

Reading Paddle on each request ties every request to Paddle. Paddle can
deliver an event twice and out of order, and a delivery can fail. Paddle's
guide to provisioning access keeps a copy of the subscription from webhooks,
stores each event identifier, orders by `occurred_at`, and repairs drift with
a reconcile job. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The billing service owns its own database, `billing`, on the PostgreSQL
  service of the cloud, with its own role. No role of the core has a right on
  it, and the billing role has no right on the core.
- **The webhook.** The service checks the `Paddle-Signature` header against
  the raw body through the SDK before it parses anything. It stores the event
  identifier and ignores one that it has seen. It applies a `subscription.*`
  event only when its `occurred_at` is newer than the stored one, and answers
  200 for any other valid event.
- **The snapshot.** One function stores a subscription and its seats in one
  transaction, then sets the controls of every account that holds a seat
  through the operator API (record 0190). A control write sets the whole set
  of controls, so a retry is safe. The service retries a write that fails.
- **Coverage.** A subscription in `active` or `past_due` covers its seats: the
  standing is `active`, and the limits and the switches come from the plan of
  record 0195. Every other status covers nothing: the standing is `locked`
  with a removal time `90 days` after the plan ended.
- **An account that never paid.** The cloud sets
  `NOTESAPP_NEW_ACCOUNT_STANDING` to `locked` and
  `NOTESAPP_NEW_ACCOUNT_REMOVE_AFTER` to `30 days` (record 0189).
- **The reconcile job.** Once a day, under an advisory lock, the service
  fetches by identifier each subscription that it holds as live, then lists
  each live subscription in Paddle, and applies each snapshot. It mails the
  owner each difference that it repaired.
- **The account events.** The service reads the events of record 0190 after
  its cursor. A removed member frees the seat. A removed billing owner cancels
  the subscription at once.
- **A duplicate.** A checkout is refused for an account that holds a seat or
  bills a subscription. A second subscription that still appears gets no
  seat, and the service mails the owner, who cancels and refunds it in the
  Paddle dashboard.
- The service mails the account when its plan ends. The core sends the mails
  before a removal (record 0189).

## Consequences

- An outage of Paddle stops no request of the core.
- Tests feed signed fixture events: a wrong signature changes nothing, a
  repeated event changes nothing, an older event after a newer one changes
  nothing, and a dropped cancellation still ends the coverage through the
  reconcile job.
