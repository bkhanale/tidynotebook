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
  - a published transfer limit and a download limit, each for one calendar
    month in UTC (record 0193);
  - a standing, `active` or `locked`;
  - a removal time, set only while the standing is `locked`;
  - a switch for each feature that a later design makes switchable. Teams and
    collaboration are the first two. Every switch is on by default.
- The controls carry a revision that the core raises on each change. A write
  names the revision that it read, and the core refuses it with
  `controls_changed` when the stored revision differs, so a write that was
  made from an old state cannot replace a newer one.
- The configuration gives the controls of a new account. With no setting, a
  new account is `active`, has every feature, and has no text, transfer or
  download limit. `NOTESAPP_NEW_ACCOUNT_STANDING` can make it `locked`, and
  `NOTESAPP_NEW_ACCOUNT_REMOVE_AFTER` then gives its removal time.
- `workspace_usage` counts the text bytes apart from the attachment bytes.
  `notesapp_add_usage` checks both sums of the owner account, and refuses
  every write of a `locked` account with `account_locked`.
- Record 0201 states what a `locked` account keeps and when it is removed.
- A change of a control sends the `a:` hint of record 0129.
- An administrator sets the controls on the accounts page. A service sets
  them through the operator API of record 0190.

## Consequences

- A self-hosted installation can lock and bound accounts with no billing.
- Integration tests prove each limit with the use case bypassed, the
  `account_locked` refusal of `notesapp_add_usage`, and that a write with an
  old revision changes nothing.
