# 0201. A locked account keeps a fixed list of operations

- Status: Accepted
- Date: 2026-10-04

## Context

Record 0189 gives an account the standing `locked`. Every new account of the
cloud starts `locked`, so it must still reach the portal of record 0190 to
pay. A person who does not pay must still be able to take the notes out and to
erase the account. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- One list in `packages/core` names the operations that a `locked` account
  keeps. Every other operation answers `account_locked`:
  - the identity operations: sign-in, sign-out, the sessions, the address
    check, the password reset and change;
  - the consent to a new version of the legal documents (record 0120);
  - the read of its own account, controls and usage, and the list of its
    workspaces;
  - the export of a workspace;
  - `openAccountPortal` (record 0190);
  - the sync notice stream, so the open application sees the unlock;
  - the removal of the account.
- A `locked` account signs in to one screen. When
  `NOTESAPP_ACCOUNT_PORTAL_URL` is set, the screen links it as the one action
  that unlocks the account.
- The reader path answers the closed page of record 0146 for each link of a
  `locked` account. The link comes back when the account is `active` again.
- The client keeps a save refused with `account_locked` in its queue, as it
  keeps a save refused by the quota, and sends it when the account is
  `active` again.
- A daily job under its advisory lock (record 0121) removes each `locked`
  account whose removal time has passed, through record 0111. A mail goes out
  `30 days` and `7 days` before the removal. Setting the standing to `active`
  clears the removal time.

## Consequences

- A unit test proves the list against the contract, so a new operation is
  refused for a `locked` account unless the list names it.
- An integration test takes a new `locked` account through the portal
  handoff and a control write to `active`. Others prove that a `locked`
  account can export and remove itself, and that the job never removes an
  `active` account.
- A unit test of `packages/sync` proves that a save refused with
  `account_locked` stays queued.
