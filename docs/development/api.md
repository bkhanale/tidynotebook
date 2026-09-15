# HTTP API access

This document states how a caller reaches the HTTP API and which rules every
call satisfies. `packages/api-contract/` holds the authoritative interface:
read it for a path, a parameter, a schema, or a status. To add or
change an operation, read [Adding an API operation](api-contract.md).

## One surface

NotesApp serves one application interface, the HTTP API under `/api`. The web
application and the browser sync engine are its only callers, and both reach it
through the operations that `packages/api-client` generates from the contract.

A remote Model Context Protocol server, an OAuth authorization server, and
agent tokens were part of an earlier product. Version 0.1 has none of them.
See [decision 0008](../decisions/0008-remove-the-remote-integration-surface.md).

## Authentication

The session cookie is the only credential the API accepts.

- Better Auth issues the cookie. It is `HttpOnly` and `SameSite`, and a
  deployment that serves HTTPS uses the secure cookie prefix.
- A write with a cookie must also name a served origin, through the origin
  header or the same-site fetch metadata header. A browser page always sends
  one of them, so a write with neither is refused. The served origins are one
  list, which the identity routes trust as well. See
  [decision 0039](../decisions/0039-one-list-of-served-origins.md).
- The identity adapter refuses a request that carries an authorization header.
  No bearer scheme exists, so such a request is not authenticated through the
  cookie either.
- The health, readiness, setup, and authentication protocol routes need no
  session. Every other operation needs one. Each probe answer has a second
  address at the root of the origin, for a load balancer that probes a fixed
  path, and both addresses are operations of the contract. See
  [decision 0040](../decisions/0040-a-probe-address-is-a-contract-operation.md).

## Per call authorization

The boundary verifies the actor before a handler runs, and `packages/core`
decides the action inside the same transaction that performs the write.

1. The session must exist and must map to an application account.
2. A write must name a served origin.
3. The account must be a member of the workspace that the operation names.
4. The current role must permit the action of the operation. The role is read
   from storage on every request, so a role change takes effect at once.

A denied role and a denied rule both answer with the same forbidden code, so an
answer never says which of the two applied. A workspace the actor cannot see
answers not found, which is also the answer for a workspace that does not
exist.

## Preconditions and linear history

A caller must not lose work when two changes race.

- **Optimistic concurrency.** An update, a delete, and a restore all need the
  expected head revision, through the entity tag header or the body.
- **Ordered updates.** The server places a stale explicit update after the
  current head. A create that finds an existing file still fails its
  precondition.
- **Stable identifiers.** Every changeset carries a mutation identifier, so a
  retry of the same call is accepted once.

The rules behind these are in
[Files, revisions, and atomic changes](files-and-revisions.md).

## Errors

Every failure is an RFC 9457 problem document with a stable application code.
The client normalizes a transport failure into the same shape, so a caller
always branches on the code and never on a message.

## Logging

A log record names the operation, the status, and the request identifier. It
never carries note content, search text, a credential, or a rejected value.

Request headers are never logged. Redaction here is by omission: the request
serializer records the method, the URL, the host name, and the peer address
only, so an authorization header and a cookie header cannot reach a record and
no redaction list has to stay in step with a header that a later task adds. A
change that starts logging headers adds redaction in the same change.
