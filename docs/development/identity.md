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

| Variable                      | Meaning                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `NOTESAPP_ORIGIN`             | Public origin. The only trusted origin, and the cookie base. |
| `NOTESAPP_AUTH_SECRET`        | Signs sessions and tokens. At least 32 characters.           |
| `NOTESAPP_SESSION_MAX_AGE_S`  | Session life in seconds. Seven days by default.              |
| `NOTESAPP_SMTP_URL`           | Mail transport. Absent disables recovery by email.           |
| `NOTESAPP_MAIL_FROM`          | Sender address. Required when a transport is configured.     |
| `NOTESAPP_OIDC_ISSUER_URL`    | Issuer of the administrator configured provider.             |
| `NOTESAPP_OIDC_CLIENT_ID`     | Client identifier at that provider.                          |
| `NOTESAPP_OIDC_CLIENT_SECRET` | Client secret at that provider.                              |
| `NOTESAPP_OIDC_REQUIRED`      | `true` disables password sign-in for the whole deployment.   |

Startup fails when a group is half configured: a transport without a sender, a
provider without a client identifier or secret, or `NOTESAPP_OIDC_REQUIRED`
without a provider.

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
- A cookie authenticated write must come from the configured origin. A request
  whose `Origin` differs, or whose `Sec-Fetch-Site` is neither `same-origin`
  nor `none`, answers `403 forbidden`. A request without those headers did not
  come from a browser page and cannot be a cross-site request forgery; it still
  needs its session cookie.
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
lock and a content free `audit_events` record.

## Invitations

An invitation stores an address, a role, an expiry, and the SHA-256 hash of its
token. The token itself appears once, in the answer of `inviteMember`. A
deployment with a mail transport sends it; one without hands it to the inviting
administrator.

`notesapp_claim_invitation` consumes the invitation in one statement that
matches only a pending, unexpired, unrevoked row whose address is the one that
signed in. A replay of the same token updates no row and answers
`404 not_found`.

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

| Table                 | Scope     | Row policy for the runtime role                                     |
| --------------------- | --------- | ------------------------------------------------------------------- |
| `auth_user`           | identity  | An identity free connection, or an account that shares a workspace. |
| `auth_session`        | identity  | An identity free connection only.                                   |
| `auth_account`        | identity  | An identity free connection only.                                   |
| `auth_verification`   | identity  | An identity free connection only.                                   |
| `account_identities`  | identity  | Readable by the account itself and by a co-member.                  |
| `account_preferences` | account   | The account itself.                                                 |
| `agent_tokens`        | account   | The account itself.                                                 |
| `invitations`         | workspace | A member reads; an owner or an administrator writes.                |

The four Better Auth tables are not scoped by a workspace, because sign-in must
find a user by an address before any identity exists. The deployment therefore
uses two connection pools:

- The pool that Better Auth owns never sets `notesapp.account_id`. It is the
  only connection that can read a session row, a password hash, or a reset
  token.
- The pool that serves application requests always sets that value inside its
  transaction. Such a transaction can read its own account row and the address
  and display name of a co-member, and nothing else in those tables.

This is the documented exception to workspace scoping. The rest of the schema
keeps the policies that `database.md` describes.

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

### Recovery without email

```sh
export NOTESAPP_RECOVERY_PASSWORD_FILE=/run/secrets/new-password
pnpm account:recover --email owner@example.com
```

The command sets a new local password, revokes every session of that account,
and records a content free audit event. It refuses under
`NOTESAPP_OIDC_REQUIRED`, so it cannot be used to work around that policy, and
it refuses for an account that has no local credential.

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
