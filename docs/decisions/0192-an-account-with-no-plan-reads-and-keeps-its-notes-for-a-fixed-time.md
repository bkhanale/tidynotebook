# 0192. An account with no plan reads and keeps its notes for a fixed time

- Status: Accepted
- Date: 2026-10-04

## Context

On the cloud an account has no plan when it never paid, when its subscription
ended, or when it lost its seat. Refusing the sign-in would hold the notes of
a person hostage, and keeping an account forever costs storage. The sync queue
already keeps a save that the quota refused (`packages/sync/src/queue.ts`).
See [design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The account row states whether a plan covers it, when that coverage ended,
  and whether it was ever covered. Only the snapshot function of record 0193
  and the seat functions of record 0191 write these facts.
- A subscription in `active` or `past_due` covers its seats. Every other
  status covers nothing.
- An account with no plan signs in, reads, searches, exports, deletes, removes
  itself and subscribes. `notesapp_add_usage` refuses every other write with
  the error `plan_required`. Creating a published link, an invitation, a
  workspace or a theme is refused the same way.
- The reader path answers the closed page of record 0146 for each link of an
  account with no plan. The link comes back with the plan.
- The client keeps a save refused with `plan_required` in its queue, as it
  keeps a save refused by the quota, and sends it when the account is covered
  again. The editor opens notes read only, and one notice row states the
  reason and the one action: choose a plan, or, for a member, ask the billing
  owner.
- An account that was never covered is removed `30 days` after it was made,
  with a mail `7 days` before.
- An account whose plan ended keeps its notes for `90 days`. A mail goes out
  when the plan ends, `30 days` before the removal and `7 days` before it.
- The removal is the removal of record 0111. A daily job under its advisory
  lock (record 0121) finds the accounts past their time. The times live in
  `packages/core/src/billing/retention.ts`.
- With billing `off`, every account is covered and none of this runs.

## Consequences

- An account with no plan costs storage for a bounded time and nothing else.
- Integration tests prove each refusal with the use case bypassed, that a
  deletion still works, and that the job never removes a covered account. A
  unit test of `packages/sync` proves that a save refused for the plan stays
  queued.
