# 0226. The application origin issues MCP grants

- Status: Accepted
- Date: 2026-10-14

## Context

An MCP client needs an authorization server that it can discover, register
with, and send the person to for consent. The consent needs the session of
the person, which lives on the application origin. Record 0208 says that a
remote MCP issuer resolves into the shared actor. Record 0186 says that the
self-hosted edition sends nothing out. See
[design 026](../design/026-a-remote-mcp-server.md).

## Decision

- The application origin is the authorization server. The OAuth provider and
  CIMD plugins of Better Auth implement it in `apps/server/src/auth/`. Its
  routes join the exact route list of the Better Auth adapter, and the
  metadata answers at the RFC 8414 well-known path.
- The server follows the OAuth 2.1 profile of the MCP specification: the
  authorization code grant only, PKCE with S256 only, the issuer in each
  authorization response (RFC 9207), and the `resource` parameter (RFC 8707),
  which must name the MCP resource of record 0225.
- A client registers through a Client ID Metadata Document or through Dynamic
  Client Registration. No client is pre-registered. A CIMD fetch refuses a
  private address and a redirect, and has a time bound and a size bound. DCR
  has a bound per client address through the counters of record 0121 and a
  bound in total. A client that no grant uses expires.
- The scopes are `notes:read` and `notes:write`, and `offline_access` for a
  refresh token. On the consent page, the person selects read only or read and
  write. The page names the client, the host of its redirect, and marks a DCR
  client as not verified. A locked account cannot give consent.
- An access token is opaque, and only its digest is at rest. It lives `1 h`.
  A refresh token rotates on each use and lives `30 d` from its last use. A
  reused refresh token revokes the whole grant.
- A grant covers every workspace of the account and resolves to the actor of
  record 0208, with the account and its rights read on each request.
- A grant is a connected app. Settings lists each one with its client, its
  access and its last use, and revokes it. An account has a bounded count of
  grants. A password change or recovery, a disabled account and a removed
  account revoke every grant. A locked account keeps the list and the revoke
  action, which refines record 0201.
- No credential and no client document from a token request reaches a log.

## Consequences

- Better Auth moves to the release that its OAuth provider plugin needs.
  Its tables are identity tables. Only the identity role reads them, and the
  runtime role reaches a grant through a narrow function.
- The installation reaches out to the address of a CIMD client, and to no
  other place.
- Tests prove discovery, both registrations and their bounds, PKCE, the
  issuer, resource binding, refresh rotation and reuse, expiry, revocation,
  invalidation by the account, and the consent page in light and in dark.
