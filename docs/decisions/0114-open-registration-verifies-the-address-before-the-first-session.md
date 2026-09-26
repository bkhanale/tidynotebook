# 0114. Open registration verifies the address before the first session

- Status: Accepted
- Date: 2026-09-26

## Context

Record 0108 lets an installation turn on the `open` registration policy while
it runs. A stranger can then type any address. `apps/server/src/auth/better-auth.ts`
sets `requireEmailVerification` to false, Better Auth reads that option once at
startup, and every existing identity user is unverified. Mail is optional in
`apps/server/src/config.ts`. See [design 016](../design/016-a-public-service.md).

## Decision

Better Auth requires a verified address for every sign-in, on every
installation. First-run setup and an accepted invitation mark the address
verified when they make the account. The migration of this change marks every
existing identity user verified, so no installation loses its owner on upgrade.

An open sign-up makes a pending account with an unverified address. Better Auth
sends a verification link. The first session makes the account active. A
pending account that nobody verifies expires after a time from the
configuration, and a job removes it with its identity user.

A second sign-up for the address of a pending account replaces that account
and its password. The verification mail says to ignore it when the reader did
not sign up. An attacker who signs up first with the address of another person
therefore cannot keep a password on an account that the owner of the address
later verifies.

A sign-up answers the same status and body for a new address and for a known
one. For a known active address, the mail goes to its owner, says that
somebody tried to sign up with it, and offers sign-in and password reset. The
handler does the same work in both branches, so the time of the answer does
not show the branch. The mail of a sign-up counts against a limit for each
target address, so a sign-up cannot flood the mailbox of another person.

The use case refuses to set the policy to `open` until the installation has a
mail transport, a published origin (record 0118), and both legal documents
(record 0120). The answer names the missing part.

## Consequences

- No session exists for an address that nobody proved.
- A stranger cannot learn from a sign-up whether an address has an account.
- A self-hosted installation with the `invitation` policy needs no mail.
- Integration tests prove the equal answers, the refused sign-in of a pending
  account, the replaced pending account, the job that removes an expired one,
  the mail limit, each precondition of `open`, and that an upgraded
  installation still signs in.
