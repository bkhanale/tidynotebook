# HTTP API access

This document states how a caller reaches the HTTP API and which rules hold.
`packages/api-contract/` holds the authoritative interface. To add or change
an operation, read [Adding an API operation](api-contract.md).

## The surfaces

The web application, sync engine and programs reach the HTTP API under `/api`.
`packages/api-client` generates its operations from the contract.

Every address under `/published/` is a published read-only link with no
security scheme. See [The reader path](#the-reader-path).

The remote MCP endpoint sits on the origin that `NOTESAPP_MCP_ORIGIN` names.
The application origin issues its OAuth grants. With no setting, the endpoint,
its metadata and the OAuth routes stay off.
`packages/api-contract/paths/mcp.yaml` declares the protocol boundary.
See [The remote MCP server](mcp.md) and
[record 0225](../decisions/0225-the-server-answers-mcp-on-its-own-origin.md).

## Authentication

Each operation declares its accepted credential in the contract.

- Better Auth issues the cookie. It is `HttpOnly` and `SameSite`, and a
  deployment that serves HTTPS uses the secure cookie prefix.
- A write with a cookie must also name a served origin, through the origin
  header or the same-site fetch metadata header. A browser page always sends
  one of them, so a write with neither is refused. The served origins are one
  list, which the identity routes trust as well. See
  [decision 0039](../decisions/0039-one-list-of-served-origins.md).
- First-run setup issues a cookie rather than reading one, and it applies the
  same origin rule itself.
- A personal API key uses the authorization header on operations that accept
  it. An explicit credential never falls back to a cookie. Session operations
  require the cookie. See
  [record 0208](../decisions/0208-personal-keys-resolve-to-the-shared-actor.md).
- MCP accepts only its resource-bound OAuth access token. It refuses a cookie
  and a personal key. The token cannot authenticate a network call to `/api`.
  A tool delegates only its registered operations inside the same process.
  See [record 0227](../decisions/0227-a-tool-calls-the-contract-as-the-actor-of-its-grant.md).
- The health, readiness, setup, and authentication protocol routes need no
  session. Other operations need the credential they declare. Each probe answer has a
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

1. The credential must map to a current application account.
2. A write with a browser session must name a served application origin.
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

An HTTP API failure is an RFC 9457 problem document with a stable application code.
The client normalizes a transport failure into the same shape, so a caller
always branches on the code and never on a message.
OAuth and MCP keep their protocol answers. See [The remote MCP server](mcp.md).

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
