# 0189. An account carries limits, a standing and feature switches

- Status: Accepted
- Date: 2026-10-04

## Context

The cloud must stop the writes of an account that does not pay, bound the
bytes that cost the most, turn off a feature for a plan, and remove an account
after a time. A self-hosted operator can use the same controls. The account
row already holds a byte limit that `notesapp_add_usage` checks (record 0112),
and record 0111 already removes an account. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The account row carries the controls:
  - the storage limit of record 0112;
  - a text limit, over the bytes of text and history only;
  - a published transfer limit for each calendar month in UTC (record 0193);
  - a standing, `active` or `locked`;
  - a removal time, set only while the standing is `locked`;
  - a switch for each feature that a later design makes switchable. Teams and
    collaboration are the first two. Every switch is on by default.
- The configuration gives the controls of a new account. With no setting, a
  new account is `active`, has every feature, and has no text or transfer
  limit. `NOTESAPP_NEW_ACCOUNT_STANDING` can make it `locked`, and
  `NOTESAPP_NEW_ACCOUNT_REMOVE_AFTER` then gives its removal time.
- `workspace_usage` counts the text bytes apart from the attachment bytes.
  `notesapp_add_usage` checks both sums of the owner account, and refuses
  every write of a `locked` account with `account_locked`.
- A `locked` account signs in to one screen. It exports every workspace and
  removes the account, and nothing else. When `NOTESAPP_ACCOUNT_PORTAL_URL` is
  set, the screen links it as the one action that unlocks the account. Every
  other operation answers `account_locked`.
- The reader path answers the closed page of record 0146 for each link of a
  `locked` account. The link comes back when the account is `active` again.
- The client keeps a save refused with `account_locked` in its queue, as it
  keeps a save refused by the quota, and sends it when the account is
  `active` again.
- A daily job under its advisory lock (record 0121) removes each `locked`
  account whose removal time has passed, through record 0111. A mail goes out
  `30 days` and `7 days` before the removal. Setting the standing to `active`
  clears the removal time.
- A change of a control sends the `a:` hint of record 0129.
- An administrator sets the controls on the accounts page. A service sets
  them through the operator API of record 0190.

## Consequences

- A self-hosted installation can lock, bound and remove accounts with no
  billing.
- Integration tests prove each refusal with the use case bypassed, that a
  `locked` account can still export and remove itself, and that the job never
  removes an `active` account. A unit test of `packages/sync` proves that a
  save refused with `account_locked` stays queued.
