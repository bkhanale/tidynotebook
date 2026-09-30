# 0141. A person resets a password in the application

- Status: Accepted
- Date: 2026-10-01

## Context

`authRoutes` in `apps/server/src/auth/better-auth.ts` mounts the reset routes
of Better Auth, and the message of a repeated sign-up tells the person to
select Forgot password. No screen of `apps/web` asks for a reset or takes the
new password, so a person of a public installation who forgets a password
must write to the operator. The reset message counts against no limit of its
address, so a stranger can send it to one mailbox without end, and it is
written in a different place from every other message of the server.

## Decision

- Sign in offers Forgot password when the installation has a mail transport.
  `getSetupStatus` states it. `/forgot-password` asks for the address and
  says the same thing for every address.
- The reset message links `/reset-password` of the application with the
  token in the fragment, as the links of records 0108 and 0114 do. That page
  sends the token and the new password to the reset operation.
- After a reset, a second message tells the owner of the address that the
  password changed, and Better Auth ends every session of the account.
- `apps/server/src/auth/messages.ts` writes every message of the server. Each
  one is plain text, names the product and the installation, and carries
  `Auto-Submitted: auto-generated` (RFC 3834).
- A message that a person with no session can cause, a sign-up, a repeated
  sign-up and a reset, passes one budget for each address. The composition
  gives the auth instance and open registration the same budgeted transport,
  so a new sender cannot skip it.

## Consequences

- A person recovers an account with no help from the operator.
- A mailbox gets at most the budget of messages in an hour, whoever asks.
- `messages.test.ts` proves each message, and
  `tests/integration/password-reset.test.ts` the served reset and the budget.
