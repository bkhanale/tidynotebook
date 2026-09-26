# 0108. An account comes in through one registration path

- Status: Accepted
- Date: 2026-09-26

## Context

`linkFirstAccount` in `packages/storage-server/src/identity-store.ts` is the
only guard of the one-account rule. The function it calls,
`notesapp_link_account`, has no limit, and the runtime role may execute it. A
second account needs a way in, and that way must not be a TypeScript check that
one caller can skip. See
[design 015](../design/015-several-accounts-on-one-installation.md) and
[design 016](../design/016-a-public-service.md).

## Decision

An account comes in through one database function. It takes the identity user,
and either the digest of an invitation or no invitation. In one transaction it
locks the invitation row and refuses a used, revoked or expired one. With no
invitation, it reads the registration policy of the installation and refuses
unless the policy is open. It then creates the account, its personal
workspace, its preferences, its cursor and its owner row, and it marks the
invitation used. The runtime role loses the right to execute
`notesapp_link_account`.

An invitation is a random token. Only its SHA-256 digest is at rest, with a
check constraint on the shape, as in record 0030. It binds one address and has
an expiry from the configuration. An administrator makes one in the
application, and `pnpm account:invite` makes one for the operator. The link
goes by mail when a transport exists, and is shown once otherwise.

The registration policy is one row of installation settings in the database:
`invitation` or `open`. Every installation starts with `invitation`. Record
0114 states the preconditions of `open`.

One contract operation of this server serves both paths. The Better Auth
sign-up route stays unmounted. The handler validates first, creates the
identity user, calls the function, and deletes the identity user when the
function refuses. First-run setup keeps its own lock and makes the first
administrator. `accountForSession` in `apps/server/src/auth/actor.ts` stops
linking an unlinked identity.

## Consequences

- The database refuses an account that no invitation and no open policy
  allows, whatever the layers above it do.
- Two acceptances of one invitation make one account. The second leaves no
  identity user.
- An invalid invitation answers one message. It does not say why.
- `tests/integration/` proves each refusal with the use case bypassed, and the
  race of two acceptances.
