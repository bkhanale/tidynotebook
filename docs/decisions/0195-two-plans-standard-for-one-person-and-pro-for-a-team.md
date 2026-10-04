# 0195. Two plans: Standard for one person and Pro for a team

- Status: Accepted
- Date: 2026-10-04

## Context

The price is for each user. History and publishing belong to every plan.
Teams and collaboration belong to Pro, and collaboration does not exist yet.
The controls of record 0189 carry the limits and the feature switches. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- One catalog in the billing service holds the plans. The service, its pages
  and the landing site read it. A GB is `1000000000` bytes.

| Plan     | Month, each seat | Year, each seat | Seats        | Storage | Text and history | Published transfer, each month | Teams and collaboration |
| -------- | ---------------- | --------------- | ------------ | ------- | ---------------- | ------------------------------ | ----------------------- |
| Standard | `$5`             | `$50`           | `1`          | `10 GB` | `2 GB`           | `10 GB`                        | Off                     |
| Pro      | `$10`            | `$100`          | `1` to `100` | `50 GB` | `2 GB`           | `50 GB`                        | On                      |

- No trial and no free plan. The refund of record 0194 does the work of a
  trial.
- The account that paid is the billing owner. It holds the first seat and
  cannot leave it.
- A Pro billing owner invites an address to a seat. The person accepts with
  an account of that address that no plan covers and that bills nothing. Seats
  in use plus open invitations never pass the seat count. At most `20` seat
  invitations go out for each subscription in a day.
- A seat covers one account and shares nothing. Sharing a workspace is the
  later collaboration design, and the members of a subscription are its first
  group.
- A seat ends when the owner removes the member, the member leaves, or the
  member removes the account. The account is then `locked` (record 0196).
- The billing owner changes the seat count, the plan and the interval on the
  billing pages, with immediate proration after a preview of the amount. The
  count cannot go below the seats in use plus the open invitations. A move to
  Standard needs a count of `1`.
- When a snapshot from Paddle carries fewer seats than the accounts that hold
  one, the newest seats lose their coverage first, never the seat of the
  billing owner.
- The billing owner cannot hand the subscription to another account. A billing
  owner who removes the account cancels the subscription at once, and each
  member receives a mail.

## Consequences

- A change of a price or a limit is one edit of the catalog, one change of the
  price in Paddle, and a deploy. The check command fails when a Paddle price
  differs from the catalog in amount, currency or interval.
- Tests of the billing service prove that two acceptances of the last seat
  make one member, and the order in which a lost seat count removes coverage.
