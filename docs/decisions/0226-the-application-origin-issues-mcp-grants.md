# 0226. The application origin issues MCP grants

- Status: Accepted
- Date: 2026-10-14

## Context

An MCP client discovers an authorization server, registers, and sends the
person to consent, which needs the session on the application origin. A remote
MCP issuer resolves into the shared actor (record 0208), and the self-hosted
edition sends nothing out (record 0186). See
[design 026](../design/026-a-remote-mcp-server.md).

## Decision

- The application origin is the authorization server. The OAuth provider
  plugin of Better Auth, and its CIMD plugin with the profile `mcp-2026-07-28`
  and the Node transport `@better-auth/cimd/node`, implement it in
  `apps/server/src/auth/`. Its routes join the exact route list of the
  adapter. The metadata answers at the RFC 8414 well-known path.
- The OAuth routes keep the error body and headers of RFC 6749 and take the
  form encoding of a token request. The other identity routes keep their
  problem answer.
- The grants are `authorization_code` and `refresh_token`, and every other
  grant is refused. PKCE is S256 only, each authorization response names the
  issuer (RFC 9207), and `resource` (RFC 8707) must name the MCP resource.
- A client registers through a Client ID Metadata Document or through Dynamic
  Client Registration. No client is pre-registered. A CIMD fetch refuses a
  private address and a redirect, and has a time and a size bound. A new CIMD
  fetch and a DCR request count against the address through the counters of
  record 0121 before any work. One total bound, checked under a lock, covers
  the clients of both kinds. A client that no grant used for `30 d` expires.
- The scopes are `notes:read` and `notes:write`, and `offline_access`. When a
  client asks for write, the person can give read only instead. The consent
  page shows every name as the claim of the client. It shows the host of the
  CIMD document as the identity, marks a DCR client as not verified, and warns
  when the answer goes to an app on this computer. A locked account cannot
  give consent.
- An access token is opaque, and only its digest is at rest. It lives `1 h`.
  A refresh token rotates on each use and lives `30 d` from its last use. A
  reused refresh token revokes the whole grant. A token request holds an
  advisory lock on the digest of its refresh token, so a rotation and a
  revocation on two replicas never interleave.
- A grant covers every workspace of the account and resolves to the actor of
  record 0208, with the account and its rights read on each request.
- A grant is a connected app. Settings lists each one with its client, its
  access and its last use, and revokes it. An account has a bounded count of
  grants. A password change or recovery, a disabled account and a removed
  account revoke every grant. A locked account keeps the list and the revoke
  action, which refines record 0201. No credential reaches a log.

## Consequences

- Better Auth moves to the release that its OAuth provider plugin needs.
  Its tables are identity tables. Only the identity role reads them, and the
  runtime role reaches a grant through a narrow function.
- The installation reaches out to a CIMD address only.
- Tests prove discovery, both registrations and the total bound, each refused
  grant, PKCE, the issuer, resource binding, refresh rotation and reuse on two
  instances, expiry, revocation, account invalidation, and the consent page.
