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

- The billing service owns a database, `billing`, with its own role. No role
  of the core and the billing role have a right on the other database.
- **The webhook.** The service checks the `Paddle-Signature` header against
  the raw body through the SDK before it parses anything. It stores the event
  identifier and ignores one that it has seen. It applies a `subscription.*`
  event only when its `occurred_at` is newer than the stored one, and answers
  200 for any other valid event.
- **The snapshot.** One function stores a subscription and its seats in one
  transaction. In the same transaction it marks each account whose controls
  must change in an outbox table. The outbox names the account, never the
  controls to write.
- **The delivery.** A worker takes each marked account in order, computes the
  controls from the newest state of the billing database, reads the controls
  and their revision through the operator API (record 0190), and writes them
  with that revision. On `controls_changed` it reads again and computes again.
  It clears the mark only after a write succeeds or the controls already
  match. The outbox lives in the database, so a restart loses no work, and a
  retry never sends an old state.
- **Coverage.** A subscription in `active` or `past_due` covers its seats: the
  standing is `active`, and the limits and the switches come from the plan of
  record 0195. Every other status covers nothing: the standing is `locked`
  with a removal time `90 days` after the plan ended.
- **An account that never paid.** The cloud starts each new account `locked`,
  with a removal time `30 days` later (record 0189).
- **The reconcile job.** Once a day, under an advisory lock, the service
  fetches by identifier each subscription that it holds as live, then lists
  each live subscription in Paddle, and applies each snapshot. It mails the
  owner each difference that it repaired.
- **The account events.** The service reads the events of record 0190 after
  its cursor. A removed member frees the seat. A removed billing owner cancels
  the subscription at once.
- **A duplicate.** A checkout is refused for an account that holds a seat or
  bills a subscription. A second one that still appears gets no seat, and the
  owner cancels and refunds it by hand after a mail.
- The service mails the account when its plan ends. The core sends the mails
  before a removal (record 0201).

## Consequences

- An outage of Paddle stops no request of the core.
- Signed fixture events prove that a wrong signature, a repeated event and an
  older event change nothing, and that a dropped cancellation still ends the
  coverage. A test fails an activation write, applies a cancellation,
  restarts the service, and proves that the account ends `locked`.
