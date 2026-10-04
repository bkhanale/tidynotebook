# 0191. A subscription buys seats and a seat covers one account

- Status: Accepted
- Date: 2026-10-04

## Context

The price is for each user, so one buyer can pay for a group. Accounts do not
share a workspace yet. An invitation already carries a target, and design 015
planned a second target (record 0108). See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- A subscription has one plan, one interval and a seat count from `1` to
  `100`. The Paddle quantity of its one item is the seat count.
- The account that paid is the billing owner. It always holds one seat, and
  it cannot leave that seat.
- A seat covers one account and shares nothing. Each account keeps its own
  workspaces and its own limits from the plan.
- The billing owner invites an address to a seat. The invitation is the token
  of record 0108 with the target `seat` and the subscription. It is accepted
  by a new account through the registration function, or by an existing
  account that no plan covers and that bills no subscription. The address of
  that account must equal the address of the invitation. A seat
  invitation counts against the seats, so seats in use plus open invitations
  never pass the seat count.
- A seat ends when the billing owner removes the member, when the member
  leaves, or when the member removes their account. The account then has no
  plan (record 0192).
- The billing owner changes the seat count, the plan and the interval in the
  application. The server sends each change to Paddle with immediate
  proration, after a preview that states the amount. The count cannot go below
  the seats in use plus the open invitations.
- When a snapshot from Paddle carries fewer seats than the accounts that hold
  one, the newest seats lose their coverage first. The seat of the billing
  owner is never lost this way.
- The billing owner cannot hand the subscription to another account. A billing
  owner who removes their account cancels the subscription at once, after a
  confirmation that names it, and each member receives a mail.
- Seat changes take the subscription lock. The lock order of record 0112
  becomes: the installation lock, the subscription locks, the workspace locks,
  the account locks, each in identifier order.

## Consequences

- The collaboration design can use the members of a subscription as its first
  group.
- Integration tests prove that two acceptances of the last seat make one
  member, that a lower count is refused below the seats in use, and the order
  in which a lost seat count removes coverage.
