# HTTP API access

This document specifies how a caller reaches the notesapp HTTP API and which
rules every call must satisfy. `packages/api-contract/openapi.yaml` is the
authoritative interface. To add or change an operation, read
[api-contract.md](api-contract.md).

## Overview

Notesapp serves one application interface: the HTTP API under `/api`. The web
application and the browser sync engine are its only clients, and both call it
through the operations that `packages/api-client` generates from the contract.

A remote Model Context Protocol server, an OAuth authorization server and
agent tokens were part of an earlier product. Version 0.1 does not have them.
A stdio MCP adapter comes back in a later release on top of the same contract.

## Authentication

The session cookie is the only credential that the API accepts.

- Better Auth issues the cookie. It is `HttpOnly` and `SameSite`, and a
  deployment that serves https uses the `__Secure-` cookie prefix.
- A write with a cookie must also name the configured origin. The request
  carries `Origin`, or it states `Sec-Fetch-Site: same-origin`. A write with
  neither header is refused, because a browser page always sends one of them.
- The identity adapter refuses a request that carries an `Authorization`
  header. No bearer scheme exists, so such a request is not authenticated
  through the cookie either.
- `/api/health`, `/api/readiness`, `/api/setup` and the authentication protocol
  routes need no session. Every other operation needs one.

## Per-call authorization

The boundary verifies the actor before a handler runs, and the core decides the
action inside the same transaction that performs the write.

1. **Session validity.** The session must exist and must map to an application
   account.
2. **Origin.** A write must name the configured origin, as above.
3. **Workspace access.** The account must be a member of the workspace that the
   operation names.
4. **Action grant.** The current role must permit the action of the operation
   (`read`, `write`, `history`, `purge`). The role is read from storage on
   every request, so a role change takes effect at once.

A denied role and a denied rule both answer `403` with the code `forbidden`, so
an answer never says which of the two applied.

## Preconditions and linear history

A caller must not lose work when two changes race:

- **Optimistic concurrency.** `updateFile`, `deleteFile`, `createCheckpoint`
  and `restoreRevision` need the expected revision of the head, through
  `If-Match` or through `expectedRevisionId`.
- **Ordered updates.** The server places a stale explicit update after the
  current head. A create that finds an existing file still fails its
  precondition.
- **Stable identifiers.** Every changeset carries a mutation identifier, so a
  retry of the same call is accepted once.

## Errors

Every failure is an RFC 9457 problem document with the media type
`application/problem+json` and a stable application `code`. The client
normalizes a transport failure into the same shape, so a caller always branches
on `code`.
