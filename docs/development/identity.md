# Single-user identity

NotesApp has one user. The user signs in with an email address and a password.
There is no invitation, no shared workspace, and no browser SSO provider.

`apps/server/src/auth/` owns this area. Read `setup.ts` for the first-run path
and `better-auth.ts` for the mounted routes and the configuration.

## First-run setup

The setup operation reports whether an account exists. While none exists, the
login page asks for an address and a password and sends them to the same
operation.

The operation takes an advisory database lock and creates the Better Auth user,
the application account, and the first workspace in one transaction. A second
request cannot create another account, and the public sign-up route is not
mounted. `pnpm owner:bootstrap` supports an unattended installation and follows
the same one-account rule.

## Sign-in

Better Auth owns password hashing, sessions, reset tokens, and cookie security.
NotesApp mounts only the browser routes it needs; `better-auth.ts` states the
exact list, and the adapter refuses a route outside it, so a library release
cannot widen the surface without a reviewed change.

A password has a minimum length. A session cookie is `HttpOnly` and
`SameSite`, and an HTTPS deployment also marks it secure. A cookie write must
name a served origin, and the identity routes trust the same list. See
[HTTP API access](api.md) and
[decision 0039](../decisions/0039-one-list-of-served-origins.md).

## Account mapping

Better Auth uses its own user identifier. The application maps that identifier
to one account, and the first-account operation creates the account, its
settings, its workspace, its usage record, its sync cursor, and its owner row
in one transaction.

The workspace owner row stays part of the storage model, because it is what the
row access policies read. No product operation can add a member, invite an
address, or move ownership. The role type has one value, and the permission
matrix grants only the actions that have a reachable operation. A stored
membership row with any other role grants nothing.

See [decision 0005](../decisions/0005-workspace-is-an-implicit-container.md)
for why the workspace stays implicit.

## Password recovery

With a mail transport configured, the sign-in page can send a reset link.
Without one, the operator runs `pnpm account:recover`. The command reads a
password from a protected file or a hidden prompt and revokes the old sessions.
There is no in-application recovery for an installation with no mail transport,
so the hosting guide names the command.

## What holds the boundary

- The runtime database role cannot read a password hash or a session token, and
  the identity role cannot read note content. See [Database](database.md).
- The setup operation refuses to run after the first account exists.
- The public sign-up route is not mounted.
- No answer exposes the session token to page script.
- No log holds a password, a cookie, a token, note text, or search text.
