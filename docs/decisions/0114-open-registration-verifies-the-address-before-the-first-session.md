# 0114. Open registration verifies the address before the first session

- Status: Accepted
- Date: 2026-09-26

## Context

Record 0108 lets an installation turn on the `open` registration policy. A
stranger can then type any address, and `apps/server/src/auth/better-auth.ts`
sets `requireEmailVerification` to false. Mail is optional in
`apps/server/src/config.ts`. See [design 016](../design/016-a-public-service.md).

## Decision

An open sign-up makes a pending account. Better Auth sends a verification link
and refuses every sign-in until the address is verified. The first session
makes the account active. A pending account that nobody verifies expires after
a time from the configuration, and a job removes it with its identity user.
An invitation that went by mail proves the address, so its account starts
verified.

A sign-up answers the same status and body for a new address and for a known
one. For a known address, the mail goes to the existing owner, says that
somebody tried to sign up with it, and offers sign-in and password reset. The
handler does the same work in both branches, so the time of the answer does
not show the branch.

The use case refuses to set the policy to `open` until the installation has a
mail transport, a published origin (record 0118), and both legal documents
(record 0120). The answer names the missing part.

## Consequences

- No session exists for an address that nobody proved.
- A stranger cannot learn from a sign-up whether an address has an account.
- A self-hosted installation with the `invitation` policy needs no mail.
- Integration tests prove the equal answers, the refused sign-in of a pending
  account, the job that removes it, and each precondition of `open`.
