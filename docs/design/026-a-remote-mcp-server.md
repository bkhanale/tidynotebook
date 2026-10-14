# A remote MCP server

Status: active

A person wants an AI assistant to read and change the notes of their account.
Claude, ChatGPT, editors and agent tools reach a service through the Model
Context Protocol (MCP). This design adds a remote MCP server to tidy notebook,
for the self-hosted edition and for the cloud. It follows the 2026-07-28
revision of the MCP specification and the OAuth profile that it names.

## The problem

Today a program reaches an account only through a personal API key and the
generated client ([design 025](025-personal-api-keys.md)). An AI client does
not work that way. It finds the server from one address, discovers how to get
a credential, registers itself, sends the person to a consent page, and calls
named tools with a short-lived token. None of those parts exist in tidy
notebook.

[Record 0008](../decisions/0008-remove-the-remote-integration-surface.md)
deleted an earlier MCP server, an OAuth server and agent tokens, because no
person used them. It said that MCP returns as a local stdio adapter with a
manually issued token. [Record 0208](../decisions/0208-personal-keys-resolve-to-the-shared-actor.md)
later said that a future remote MCP issuer needs OAuth consent and resolves
into the shared actor. The common AI clients now connect to a remote address
and expect OAuth. A local adapter serves none of the hosted clients, so this
design replaces the stdio path of record 0008.

## Where it belongs

The MCP server belongs to the core, and the cloud hosts it.

- The self-hosted edition has every feature
  ([record 0186](../decisions/0186-the-open-core-holds-no-billing-and-a-private-service-sells-the-cloud.md)).
  MCP is not billing, so an operator who hosts tidy notebook gets it too.
- The private service of the cloud reaches the core only through the operator
  API, and that API never reads or writes a note
  ([record 0190](../decisions/0190-an-operator-api-reaches-the-account-controls.md)).
  An MCP server of the cloud would need a second, person-level way into the
  core.
- The consent page needs the session of the person, which lives on the
  application origin of the core. The grant must resolve into the actor of the
  core (record 0208).

The cloud gives the server its own address, `mcp.tidynotebook.com`, as a
domain of the application service, and every account of the cloud can use it.
The records of the private repository hold that part.

## The standard that applies

The MCP server is an OAuth 2.1 resource server. The specification asks for:

- The Streamable HTTP transport. The 2026-07-28 revision removes the session
  and the handshake, so each request carries its own version and
  capabilities. A stateless server runs on any replica with no shared session
  store.
- Protected Resource Metadata (RFC 9728). An answer of `401` names the
  metadata address and the scopes in its `WWW-Authenticate` header.
- An authorization server that publishes its metadata (RFC 8414), requires
  PKCE with S256, includes the issuer in each authorization response
  (RFC 9207), and binds each token to one resource (RFC 8707).
- Client registration in this order of preference: a pre-registered client,
  a Client ID Metadata Document (CIMD), then Dynamic Client Registration
  (RFC 7591). The specification keeps DCR for clients that have not moved to
  CIMD yet.
- A server that accepts only tokens issued for itself, and never passes a
  token through to another service.
- A server that checks the `Origin` header, so a page in a browser cannot
  reach it through DNS rebinding.

## Options for the server

**A. The stdio adapter of record 0008.** A local process reads a personal key
from its environment and calls the HTTP API. It is small, but it serves only a
client that runs on the same computer. Claude on the web, ChatGPT and the
mobile clients cannot start a local process. This option fails the problem.

**B. A separate MCP service.** A new application of the core runs as its own
process and calls the HTTP API with the generated client. The MCP token is
issued for the MCP server, so the service cannot present it to the API without
token passthrough, which the specification forbids. It needs a token exchange
(RFC 8693) or a second token. It also adds a third command to the image
([record 0202](../decisions/0202-the-image-takes-a-migrate-and-a-serve-command.md))
and a second service to run and to watch.

**C. An MCP adapter in the server.** The server answers MCP on a configured
origin. It checks the token, resolves the shared actor, and runs each tool as
calls to the existing contract operations inside the same process. No token
leaves the process, no second service exists, and every rule of an operation
applies because the operation itself runs. The cost is the MCP library in the
server process and MCP traffic on the same replicas as the application.

Option C is the choice
([record 0225](../decisions/0225-the-server-answers-mcp-on-its-own-origin.md)).

## Options for the authorization server

**Better Auth.** The identity library of the core already owns sessions,
password hashing and the route list. Its OAuth provider plugin implements the
OAuth 2.1 profile, PKCE, the issuer parameter, resource binding, consent,
refresh tokens, revocation and DCR. Its CIMD plugin fetches a client document
with a transport that refuses private addresses and redirects. The cost is an
upgrade of Better Auth and more routes in the exact route list of the adapter.

**An authorization server of our own.** It is the most control and the most
code to keep safe. Nothing in the problem needs more than the library gives.

**An external identity provider.** A hosted provider takes the work, but a
self-hosted installation must then send each sign-in to a third party.
Record 0186 says the self-hosted edition sends nothing to the owner, and an
operator must not need a new account somewhere else.

Better Auth is the choice
([record 0226](../decisions/0226-the-application-origin-issues-mcp-grants.md)).

## Tokens, scopes and consent

An access token is opaque. Only its digest is at rest, as for a personal key,
so revocation takes effect on the next request and a database copy holds no
working token. A JWT would need no lookup, but it cannot be revoked before it
expires, and the server already reads the account on each request. The access
token lives a short time. A refresh token rotates on each use, and a reused
refresh token ends the whole grant.

Two scopes state what a client can do: `notes:read` and `notes:write`. The
first challenge asks for read only. A write tool that a read grant calls gets
a challenge for write, so the client asks the person again. When a client asks
for write, the person can give read only instead.

A client chooses its own name, so the consent page shows every name as the
claim of the client. The identity that the page shows is the host of the CIMD
document. A client that registered itself through DCR has no such host and
shows as not verified. When the answer goes to an app on the same computer,
the page says so.

A grant covers every workspace of the account, as a personal key does. A
narrower grant per workspace would add a second rights matrix, which
record 0208 refused. The scopes only narrow which tools a client can call.
The rights of the account still decide each operation.

A refresh token rotates. When a stolen refresh token is used again, the whole
grant ends. Two replicas can see the rotation and the reuse at the same
moment, so a token request finds the client and the account of its token and
takes an advisory lock on that pair. It reads the token again under the lock,
and every issue and revocation of the pair holds the same lock. The OAuth routes keep the error body of RFC 6749 and the form encoding
of a token request, and the other identity routes keep their problem answer.

Settings gets a section of connected apps. It lists each grant with its
client, its access and when it was last used, and it revokes one. A password
change, a disabled account and a removed account end every grant, as they end
every key. A locked account keeps the list and the revoke action
([record 0201](../decisions/0201-a-locked-account-keeps-a-fixed-list-of-operations.md)).

## The tools

The server offers tools only. Resources, prompts, sampling, elicitation, tasks
and MCP Apps have uneven client support and no need in this problem. A tool
names a note by its workspace identifier and its file identifier, which the
list and search tools return together with the path. A tool never removes a
note for good, never publishes a link, and never changes an account, a
workspace or a member.

The read tools list the workspaces, list the notes of a workspace, read a
note or one of its versions, search, list the backlinks of a note and list its
history. The write tools create a note, edit a note, move or rename a note,
and move a note to Trash. Trash keeps the note, so a person can restore what
an assistant removed. Plan 022 holds the exact list and the operations that
each tool calls.

A tool calls the contract operations as the actor of the grant, inside the
server, through the same pipeline that a request from the network takes. So
the request and the answer are checked against the contract, a locked account
keeps only its list, the limits count, and the log has the same shape. A
delegation of one tool call names the operations of that tool, and the
identity adapter refuses any other operation. No request from the network can
present a delegation
([record 0227](../decisions/0227-a-tool-calls-the-contract-as-the-actor-of-its-grant.md)).

The text of a note is a CRDT document
([record 0076](../decisions/0076-the-text-of-a-note-is-a-crdt-document.md)).
A write tool on a note names the version that the client read. The tool
reads the head, and when the head is another version, it refuses and asks the
client to read the note again. So an assistant never changes text that it did
not see, and a repeated call changes nothing. An edit replaces exact text or
the whole text. It makes the update through `packages/note-document` and
sends it through `updateFile` with that version. A merge with a change of the
browser at the same moment is possible through `commitChangeset`, but a
repeated edit would then apply twice, so the first version refuses instead.
The cost is a refused edit while the person types in the same note.

## Cost and limits

Every MCP request passes the attempt counters that every process shares
([record 0121](../decisions/0121-every-limit-and-every-job-holds-across-server-processes.md)).
A grant and an account each have a request bound. An answer has a size bound,
and a long note continues through an offset. Registration through DCR or
CIMD has a bound per client address before any work. One total bound covers the clients
of DCR and of CIMD, because the CIMD plugin stores each client too. A client
that no grant uses expires. A CIMD fetch has a time bound and a size bound.

## Self-hosted and cloud

`NOTESAPP_MCP_ORIGIN` names the origin of the MCP server. With no setting, the
MCP route, the metadata and the OAuth routes answer as if they were not there,
and nothing changes for an operator who does not want MCP. The origin can be
its own host or the application origin. The cloud sets
`https://mcp.tidynotebook.com` and adds the host to Cloudflare and Railway.

## Verification

The gate proves the pure rules in `packages/core`, the served flow through the
test stack, and the protocol through the official MCP conformance suite.
Integration tests prove discovery, CIMD and DCR registration, consent, PKCE,
the issuer, audience binding, refresh rotation and reuse on two instances, revocation, scopes,
the refusal of a token of another resource, the refusal of a personal key at
the MCP route, the locked account, and that a delegation shape from the
network resolves nothing. Browser checks prove the consent page and the
connected apps in light and in dark. A staging run of the cloud connects
real clients before production.

## Open questions

None. The owner chose the core as the home, every account of the cloud,
read and write access chosen at consent, and release `0.19.0`.

## Sources

- [MCP specification, authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
  and [CIMD](https://better-auth.com/docs/plugins/cimd)
- [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728),
  [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707),
  [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207),
  [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)

## Decisions

- [0225, the server answers MCP on its own origin](../decisions/0225-the-server-answers-mcp-on-its-own-origin.md)
- [0226, the application origin issues MCP grants](../decisions/0226-the-application-origin-issues-mcp-grants.md)
- [0227, a tool calls the contract as the actor of its grant](../decisions/0227-a-tool-calls-the-contract-as-the-actor-of-its-grant.md)
