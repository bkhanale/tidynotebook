# Identity, workspaces, and agent tokens

This document describes how an account signs in, how a request becomes a
verified actor, how membership changes are guarded, and how an operator
bootstraps or recovers an account.

Two documents sit next to this one. `api-contract.md` describes how an
operation reaches the HTTP boundary. `database.md` describes the workspace
content tables and their row access policies. This document covers the identity
tables that Task 5 added and the rules above them.

## Layout

| Path                                            | Purpose                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `apps/server/src/auth/better-auth.ts`           | Pinned Better Auth configuration and the protocol adapter. |
| `apps/server/src/auth/actor.ts`                 | Session and token to verified actor.                       |
| `apps/server/src/auth/mail.ts`                  | SMTP transport of password recovery.                       |
| `apps/server/src/http/accounts.ts`              | Account, settings, and agent token handlers.               |
| `apps/server/src/http/workspaces.ts`            | Workspace, membership, and invitation handlers.            |
| `apps/server/src/cli/bootstrap.ts`              | `pnpm owner:bootstrap`.                                    |
| `apps/server/src/cli/recover-account.ts`        | `pnpm account:recover`.                                    |
| `packages/core/src/workspaces/service.ts`       | The rules. No database, no HTTP.                           |
| `packages/core/src/workspaces/ports.ts`         | The storage ports that the rules use.                      |
| `packages/storage-server/src/identity-store.ts` | The PostgreSQL implementation of those ports.              |
| `tools/sdk-codegen/src/auth-contract.ts`        | The authentication fragment of the contract.               |

## Configuration

| Variable                      | Meaning                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `NOTESAPP_ORIGIN`             | Public origin. The only trusted origin, and the cookie base.      |
| `NOTESAPP_AUTH_DATABASE_URL`  | Connection of the identity role. It must not be the runtime role. |
| `NOTESAPP_AUTH_SECRET`        | Signs sessions and tokens. At least 32 characters.                |
| `NOTESAPP_SESSION_MAX_AGE_S`  | Session life in seconds. Seven days by default.                   |
| `NOTESAPP_SMTP_URL`           | Mail transport. Absent disables recovery by email.                |
| `NOTESAPP_MAIL_FROM`          | Sender address. Required when a transport is configured.          |
| `NOTESAPP_OIDC_ISSUER_URL`    | Issuer of the administrator configured provider.                  |
| `NOTESAPP_OIDC_CLIENT_ID`     | Client identifier at that provider.                               |
| `NOTESAPP_OIDC_CLIENT_SECRET` | Client secret at that provider.                                   |
| `NOTESAPP_OIDC_REQUIRED`      | `true` disables password sign-in for the whole deployment.        |

Startup fails when a group is half configured: a transport without a sender, a
provider without a client identifier or secret, `NOTESAPP_OIDC_REQUIRED`
without a provider, or an identity connection that reuses the runtime
connection.

The migration creates the identity role and sets its password. See
`docs/development/database.md` for the two profiles and their password
sources.

## Sign-in

Better Auth 1.7.2 implements the protocol endpoints. The configuration is
pinned in `better-auth.ts`:

- Email and password sign-in with `disableSignUp`, so no request creates an
  account. A minimum password length of 12 characters. Better Auth owns the
  password hash and every token lifetime.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the origin is
  https. Better Auth then also serves the cookie under the reserved name
  `__Secure-notesapp_session`, as the cookie prefix rules require. On an http
  origin the name is `notesapp_session`.
- The session expires after `NOTESAPP_SESSION_MAX_AGE_S` and is extended while
  it is used.
- The configured origin is the only trusted origin. Better Auth checks the
  `Origin` header and the Fetch Metadata headers of a cookie authenticated
  request against it and refuses a redirect target outside it.
- The generic OAuth plugin registers the administrator configured provider.
  Discovery reads `<issuer>/.well-known/openid-configuration`. Sign-in uses the
  authorization code flow with PKCE, state, and nonce, and the ID token
  signature, issuer, and audience are verified against the discovered JWKS.
  `requireIdTokenVerification` is on, so a discovery document without a usable
  issuer and JWKS stops the provider instead of falling back to an unverified
  token.
- The external account key is the issuer and the subject. Automatic account
  linking is off in every form: `enabled: false`,
  `disableImplicitLinking: true`, `allowDifferentEmails: false`, and no trusted
  provider. Two identities with the same address are two accounts, and a
  provider that reports a familiar address can never take over a local account.

Discovery runs when the auth context is first used, not when the process
starts. A provider that is unreachable therefore fails the first sign-in
attempt rather than startup.

### Protocol endpoints

`register.ts` mounts exactly the routes in `authRoutes`:

| Method | Path                               | In the contract |
| ------ | ---------------------------------- | --------------- |
| POST   | `/api/auth/sign-in/email`          | yes             |
| POST   | `/api/auth/sign-in/social`         | yes             |
| POST   | `/api/auth/sign-out`               | yes             |
| GET    | `/api/auth/get-session`            | yes             |
| POST   | `/api/auth/request-password-reset` | yes             |
| POST   | `/api/auth/reset-password`         | yes             |
| GET    | `/api/auth/callback/:id`           | no              |
| GET    | `/api/auth/reset-password/:token`  | no              |
| GET    | `/api/auth/error`                  | no              |

Everything else that a Better Auth release serves is not mounted at all, so a
request to `/api/auth/sign-up/email` answers `404 route_not_found`.

The three endpoints outside the contract are browser navigation that answers
with a redirect, not calls that a generated client makes.

Better Auth answers a failure with its own JSON body. The adapter rewrites that
body into RFC 9457 problem details with a stable code, so the deployment
answers problem details everywhere and the library's message, which can name an
address, never leaves the server.

The six endpoints that the contract describes are checked at both ends like any
other operation. The boundary parses a copy of the raw body and validates it
against the declared schema, so a closed request body rejects an unknown member
with `400 invalid_request`, a wrong media type answers `415`, and a body larger
than the limit answers `413`. The answer is validated against the declared
response schema before it is sent, so the fragment cannot drift from what the
library actually returns. The library still receives the exact bytes the client
sent, because it may sign or hash them, and it still owns its own credential
checks.

The get-session answer is the one place where the adapter changes the body: it
removes `session.token`. The browser already holds that value in an HttpOnly
cookie, so handing the same secret to page script would only widen where it can
leak, and the contract declares the session without a token.

## The verified actor

`resolveActor` maps a request to an `Actor` from `@notesapp/core`. Only
`verifyActor` builds one, so a parsed request object can never be used where a
verified actor is required.

- A bearer credential wins over a cookie, so a browser that also holds a
  session cannot widen an agent call by accident.
- A cookie session resolves through Better Auth. Its grants are the actions of
  the current role in every workspace the account belongs to, because a browser
  session carries the full role.
- An agent token is looked up by the SHA-256 hash of its secret. An expired or
  revoked token resolves to nothing. Its grants are the stored scope
  intersected with the current role, so a scope for a workspace the account has
  left disappears completely.
- A cookie authenticated write must name the configured origin. The check is
  positive: the request carries `Origin` equal to that origin, or
  `Sec-Fetch-Site: same-origin`. A request whose `Origin` differs answers
  `403 forbidden`, and a request with neither header answers
  `403 origin_required`. A client that is not a browser sends neither header,
  and its path is an agent token rather than a session cookie.
- A request that carries an `Authorization` header is resolved as a token and
  never falls back to the cookie. A malformed or unknown bearer value answers
  `401 unauthenticated`, so a caller that meant to present a token is never
  authenticated as somebody else.
- An operation that declares only `sessionCookie` refuses an agent token, and
  the other way round.

An operation with a security requirement and no actor answers
`401 unauthenticated`. A role or scope failure inside a use case answers
`403 forbidden`, and a missing or hidden record answers `404 not_found`.

## Account mapping and the personal workspace

The application identifies an account by a UUID that never changes. A Better
Auth user maps to exactly one such account through `account_identities`.

The map row is created on the first authenticated request of that user. One
database function, `notesapp_link_account`, creates the account identifier, the
map row, the settings row, the personal workspace, its usage record, its
cursor, and the owner membership together. The call is idempotent, so a
repeated sign-in never creates a second personal workspace and a failure leaves
no half created account.

## Membership rules

The rules live in `packages/core/src/workspaces/service.ts` and are unit
tested there. Every membership write runs inside a transaction that holds the
same advisory workspace lock as a content write, so a role change and a write
of one workspace have a defined order.

- An owner or an administrator manages membership, renames the workspace, and
  creates invitations.
- An invitation grants `admin`, `editor`, or `viewer`. It never grants `owner`.
- A role change never grants or removes the owner role. Ownership moves only
  through an explicit transfer, so a workspace cannot lose its last owner
  through a role edit.
- Nobody changes or removes their own membership row.
- Only another owner removes an owner, and the last owner cannot be removed.
- A transfer needs an owner and a target that is already a member. The store
  sets the new owner before it changes the old one, so the workspace always has
  an owner. The old owner becomes an administrator, or leaves.
- Only the owner deletes a workspace. Deletion removes the membership rows, so
  every session loses access, and it removes the shares, so no public link
  survives.

Every membership change appends a `sync_changes` record under the workspace
lock and a content free `audit_events` record. That includes every write that
creates a membership rather than changing one: creating a workspace, accepting
an invitation, and the personal workspace that `notesapp_link_account` creates
on a first sign-in. That function writes the same pair inside its own
transaction, so a personal workspace starts its sync stream at cursor one just
like any other workspace.

`audit_events` is scoped to a workspace, so two records cannot live there.
`account_audit_events` holds them instead, keyed by account and readable only
by that account:

- `workspace.delete`, because deleting a workspace removes its own audit rows
  and the actor may have had no other workspace at all. The deleted identifier
  is the content free target.
- `account.recover`, which belongs to no workspace.

## Invitations

An invitation stores an address, a role, an expiry, and the SHA-256 hash of its
token. Where the token goes depends on the deployment:

- With `NOTESAPP_SMTP_URL`, the server sends the invitation by email and the
  answer of `inviteMember` carries `delivered: true` and no token. The token
  then never reaches a browser log or a shared screen.
- Without a transport, the answer carries `delivered: false` and the token, so
  the inviting administrator can hand it over out of band.

`acceptInvitation` accepts two forms, and it declares no security requirement
because the second has no session yet:

1. A signed in account whose address is the invited address. A password in that
   request is refused, because it would be a second identity for one call.
2. A request with no session that carries the token and a password. The server
   then creates the local account for the invited address, marks that address
   verified because the token proves control of it, signs the new account in,
   and creates its personal workspace. An address that already has an account
   answers `403 forbidden`: that person signs in and accepts again.

   The instance that serves requests keeps `disableSignUp` on, so registration
   is off the served surface as a second control. `auth/invitations.ts` builds
   a separate Better Auth instance over the same connection pool with sign-up
   permitted, and `/api/auth/sign-up/email` is not in `authRoutes`, so nothing
   that is mounted can reach registration.

   Creating the account and consuming the invitation cannot be one database
   transaction, because the two live behind different credentials. The order is
   create, claim, then compensate: the claim runs inside `register`, and a
   claim that fails removes the Better Auth user through
   `internalAdapter.deleteUser` and the account, its identity row, its
   settings, its account audit trail, and its personal workspace through
   `notesapp_discard_account`. The answer is then `404 not_found`, as if the
   invitation had already been consumed.

   `notesapp_discard_account` is bound to the calling account. It compares the
   target with `notesapp_current_account()` and answers false when they differ,
   so one account can never remove another and an identity free transaction
   removes nothing. The storage call therefore resolves the account first and
   opens its transaction with that identity. The function also answers false,
   rather than failing on a constraint, when:

   - the account belongs to a workspace that is not its own personal one, or
     that workspace has another member;
   - a retained record still names the account: a revision, a changeset, a
     mutation receipt, a share, a snapshot, an agent token, an invitation it
     sent or accepted, or an audit event outside its own workspaces;
   - its personal workspace holds anything at all. `contents` is checked on its
     own as well as `files`, because content can outlive the file that
     referenced it.

   Only the three rows that the sign-up path itself created are removed rather
   than treated as a reason to refuse: the settings row, the account audit
   trail, and the identity row.

`acceptInvitation` declares no security requirement, because its second form
has no session yet. The identity hook therefore does not run for it, and the
handler calls the shared `requireWriteOrigin` helper itself whenever a session
resolved. Every operation that reads a cookie without declaring a security
requirement must call that helper for the same reason.

Under `NOTESAPP_OIDC_REQUIRED` the second form answers `403 oidc_required`. The
invited person signs in through the configured provider instead, and the
invitation is claimed on that first sign-in with the matching address.

`notesapp_claim_invitation` consumes the invitation in one statement that
matches only a pending, unexpired, unrevoked row whose address is the one that
signed in. A replay of the same token updates no row and answers
`404 not_found`. Acceptance reads the workspace of the invitation first and
takes that workspace lock, so it is ordered with every other membership write,
and it appends a `membership` sync record and an audit event like the others.

## Agent tokens

A secret is 32 random bytes with the prefix `nsk_`, encoded base64url. Storage
keeps only its SHA-256 hash and the first twelve characters as a public prefix.
The secret appears once, in the answer of `createAgentToken`.

An expiry is required and can never be more than one year away. A scope is a
list of `{ workspaceId, actions[] }`, and it can never be wider than the
current role of the account in that workspace. Every use checks the membership
again, so a token narrows when the role narrows and stops working when the
membership ends. A token is revocable, and a revoked token is refused on its
next use.

An agent token may not manage credentials: `listAgentTokens`,
`createAgentToken`, `revokeAgentToken`, `updatePreferences`, `createWorkspace`,
and `acceptInvitation` accept a browser session only.

## The identity tables

Migration `0002` creates the tables and `0003` adds their rights, policies, and
functions.

| Table                 | Scope     | Row policy for the runtime role                        |
| --------------------- | --------- | ------------------------------------------------------ |
| `auth_user`           | identity  | `notesapp_auth` only. `notesapp_app` has no right.     |
| `auth_session`        | identity  | `notesapp_auth` only. `notesapp_app` has no right.     |
| `auth_account`        | identity  | `notesapp_auth` only. `notesapp_app` has no right.     |
| `auth_verification`   | identity  | `notesapp_auth` only. `notesapp_app` has no right.     |
| `account_identities`  | identity  | Neither application role. Two functions answer for it. |
| `account_preferences` | account   | The account itself.                                    |
| `agent_tokens`        | account   | The account itself.                                    |
| `invitations`         | workspace | A member reads; an owner or an administrator writes.   |

The four Better Auth tables are not scoped by a workspace, because sign-in must
find a user by an address before any identity exists. Two database roles carry
that separation instead:

- `notesapp_auth` holds every right on those four tables and no right anywhere
  else. Only the connection pool that Better Auth owns uses it, and that pool
  reads `NOTESAPP_AUTH_DATABASE_URL`.
- `notesapp_app` holds no right on them at all. An application query therefore
  cannot read a session token, a password hash, a reset token, or a provider
  `id_token` or `access_token`, however it sets its identity. The row policies
  above are the second control, not the only one.

Better Auth 1.7.2 offers no option to skip storing a provider token, so
`auth_account` keeps the `id_token` and the `access_token` that the provider
returned. Only `notesapp_auth` can read them.

Four SECURITY DEFINER functions give the application the narrow answers it
still needs: `notesapp_account_of` returns one account identifier,
`notesapp_has_account` returns whether any account exists,
`notesapp_workspace_members` returns the address and the display name of the
members of one workspace and requires a membership of its own, and
`notesapp_open_invitation` returns the workspace and the invited address of an
open invitation. None of them returns a token or a hash.

The rest of the schema keeps the policies that `database.md` describes.

Migration `0003` also narrows two earlier policies and adds one guard:

- `accounts_member_policy` now shows the account row of a co-member, which is
  what a member list needs. Migration `0001` records this widening as work of
  Task 5.
- `memberships_delete_policy` now lets only an owner delete an owner.
- A trigger, `memberships_keep_owner`, refuses an update or a delete that would
  leave a workspace without an owner. Workspace deletion sets `notesapp.purge`
  and is therefore exempt, exactly like the immutability triggers.

Five SECURITY DEFINER functions perform the writes that the runtime role holds
no right for: `notesapp_link_account`, `notesapp_create_workspace`,
`notesapp_transfer_ownership`, `notesapp_claim_invitation`, and
`notesapp_delete_workspace`. Each checks the caller's role itself.
`notesapp_agent_token` resolves a token hash before any identity exists.

## Operator procedures

### Bootstrap

```sh
export NOTESAPP_BOOTSTRAP_PASSWORD_FILE=/run/secrets/first-password
pnpm owner:bootstrap --email owner@example.com --name "Owner"
```

The command refuses to run when an account already exists, so it cannot add a
second account behind the invitation rules. It also refuses under
`NOTESAPP_OIDC_REQUIRED`, because the first account then signs in through the
provider. The password comes from the named file or from a hidden terminal
prompt. It never travels in a command argument and is never written to standard
output.

### What the operator commands use

Three paths drive Better Auth 1.7.2 through its server API rather than its HTTP
surface. These are internal names of that pinned version, so a version change
has to check them:

| Path                    | Uses                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm owner:bootstrap`  | `auth.api.signUpEmail`                                                                                                                                                                            |
| `pnpm account:recover`  | `auth.$context`, then `internalAdapter.findUserByEmail`, `internalAdapter.findCredentialAccount`, `context.password.hash`, `internalAdapter.updatePassword`, `internalAdapter.deleteUserSessions` |
| Invitation registration | `auth.api.signUpEmail`, `internalAdapter.findUserByEmail`, `internalAdapter.updateUser`, `internalAdapter.deleteUser`                                                                             |

None of them mounts an HTTP route.

A local account starts unverified: `requireEmailVerification` is off, so a
password sign-in works immediately. Only the invitation sign-up path sets
`emailVerified`, because the invitation token proves control of the address.

### Recovery without email

```sh
export NOTESAPP_RECOVERY_PASSWORD_FILE=/run/secrets/new-password
pnpm account:recover --email owner@example.com
```

The command sets a new local password, revokes every session of that account,
and records a content free audit event. It refuses under
`NOTESAPP_OIDC_REQUIRED`, so it cannot be used to work around that policy, and
it refuses for an account that has no local credential.

### An address that already has a local account

An OpenID Connect identity whose address matches an existing local account is
refused with the library's `account_not_linked` outcome, and the callback
redirects with `?error=account_not_linked` rather than issuing a session. No
user row and no account row is created for that identity. That is the intended
answer: automatic linking is off, so a provider that reports a familiar address
can never take over a local account.

An operator resolves it in one of two ways. Either the person keeps signing in
with the local password, or the operator removes the local account so that the
next provider sign-in creates a fresh one. There is no supported path that
merges the two, because that would be exactly the takeover this rule prevents.

### Recovery by email

A deployment with `NOTESAPP_SMTP_URL` sends a reset link through
`requestPasswordReset`. The link expires after one hour, works once, and
revokes every session of the account when it is used. A deployment without a
transport has no reset endpoint that can send anything; the operator command
above is the documented path.

## Tests

`tests/integration/identity.test.ts` runs against a disposable database, a real
listening server, and `tests/integration/support/identity-provider.ts`, which
is a small OpenID Connect provider with its own RSA key. It covers the
bootstrap refusal, the cookie attributes, sign-out and server side revocation,
disabled registration, invitation acceptance and replay, provider sign-in and
each of its failure modes, the absence of an address based merge, the personal
workspace, last owner protection, transfer, a role downgrade against an open
write transaction, token scope denial, token expiry and revocation, account
isolation, and the operator recovery refusal under an OpenID Connect policy.
