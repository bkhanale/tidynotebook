# HTTP API access

This document states how a caller reaches the HTTP API and which rules every
call satisfies. `packages/api-contract/` holds the authoritative interface:
read it for a path, a parameter, a schema, or a status. To add or
change an operation, read [Adding an API operation](api-contract.md).

## One surface

Tidy Notebook serves one application interface, the HTTP API under `/api`. The web
application and the browser sync engine are its only callers, and both reach it
through the operations that `packages/api-client` generates from the contract.

One second surface sits beside it. Every address under `/published/` is the
reader path of a published read-only link, and no operation there names a
security scheme. See [The reader path](#the-reader-path).

A remote Model Context Protocol server, an OAuth authorization server, and
agent tokens were part of an earlier product. Version 0.1 has none of them.
See [decision 0008](../decisions/0008-remove-the-remote-integration-surface.md).

## Authentication

The session cookie is the only credential the API under `/api` accepts.

- Better Auth issues the cookie. It is `HttpOnly` and `SameSite`, and a
  deployment that serves HTTPS uses the secure cookie prefix.
- A write with a cookie must also name a served origin, through the origin
  header or the same-site fetch metadata header. A browser page always sends
  one of them, so a write with neither is refused. The served origins are one
  list, which the identity routes trust as well. See
  [decision 0039](../decisions/0039-one-list-of-served-origins.md).
- First-run setup issues a cookie rather than reading one, and it applies the
  same origin rule itself. It is the one state changing write that a caller
  with no account can reach.
- The identity adapter refuses a request that carries an authorization header.
  No bearer scheme exists, so such a request is not authenticated through the
  cookie either.
- The health, readiness, setup, and authentication protocol routes need no
  session. Every other operation of `/api` needs one. Each probe answer has a
  second address at the root of the origin, for a load balancer that probes a
  fixed path, and both addresses are operations of the contract. See
  [decision 0040](../decisions/0040-a-probe-address-is-a-contract-operation.md).

## The reader path

A published link opens one note, or one folder and every note below it, for a
person who has no account. The owner operations sit under `/api` and keep the
session. The reader operations sit under `/published/` and declare an empty
security requirement, so the identity hook never runs for one and a handler of
one holds no actor. See
[decision 0031](../decisions/0031-the-reader-path-is-a-closed-read-only-boundary.md).

A reader carries its credentials in the address: the token is a path segment
and the reading ticket is the query parameter `ticket`. A picture inside a
server built page sets no header and runs no script, and the reader path sets
no cookie, so the address is the one place that both can travel. See
[decision 0046](../decisions/0046-the-reader-carries-its-credentials-in-the-address.md).

Every reader failure answers one shape. A link that never existed, a revoked
link, an expired link and a wrong password all answer 404 with the code
`published_link_unavailable`, and the body names no note, no folder and no
owner. The `PublishedRefusal` schema of the contract fixes every member of that
body, so the boundary refuses an answer that carries a distinguishing word.

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

## The size of an answer

A read carries what its reader uses. `getFile` answers the document of a note
only for a reader that asks for the full head, and a reader that shows the
text asks for the text alone. The default keeps the full head, so a bundle of
an earlier release still opens a note
([record 0168](../decisions/0168-a-note-read-carries-the-document-only-for-an-editor.md)).

The server compresses the JSON answer of a large read itself, in
`apps/server/src/plugins/compression.ts`, and a write and an answer that sets
a cookie leave as they are
([record 0169](../decisions/0169-the-server-compresses-a-large-json-read.md)).

## Errors

Every failure is an RFC 9457 problem document with a stable application code.
The client normalizes a transport failure into the same shape, so a caller
always branches on the code and never on a message.

## Limits and timing

A request carries three bounds. The body size limit and the total receive time
belong to the whole deployment, and one route can narrow the body size. The
attachment upload adds the bound that a streamed body needs: the longest gap
between two of its chunks. A large image over a slow link is not an attack, so
the upload measures the gap and not the whole. An upload that passes the gap
answers with the `request_timeout` code and stores nothing. The total receive
time stays longer than that gap, and `apps/server/src/config.ts` refuses a
configuration where it does not. `apps/server/src/plugins/body-idle-timeout.ts`
holds the rule.

A download names its file.
`apps/server/src/plugins/content-disposition.ts` decides what the browser does
with the bytes and encodes the name that the person gave the file. An image of
an accepted type is shown, because the note surface and the reader page point a
browser at that address. Every other media type is saved.

## Logging

A log record names the operation, the status, and the request identifier. It
never carries note content, search text, a credential, or a rejected value.

Request headers are never logged. Redaction here is by omission: the request
serializer records the method, the URL, the host name, and the peer address
only, so an authorization header and a cookie header cannot reach a record and
no redaction list has to stay in step with a header that a later task adds. A
change that starts logging headers adds redaction in the same change.
