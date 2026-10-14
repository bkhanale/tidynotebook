# 0225. The server answers MCP on its own origin

- Status: Accepted
- Date: 2026-10-14

## Context

AI clients reach a service through a remote MCP server and OAuth. Record 0008
planned a local stdio adapter, which no hosted client can start. Record 0208
left a remote MCP issuer to a later design. A separate MCP service could not
present its token to the HTTP API without the token passthrough that the MCP
specification forbids. See [design 026](../design/026-a-remote-mcp-server.md).

## Decision

- `apps/server` serves one MCP endpoint, `/mcp`, on the origin that
  `NOTESAPP_MCP_ORIGIN` names. The canonical resource is that origin with the
  path `/mcp`. The origin can be its own host or the application origin.
- With no setting, the MCP endpoint, its metadata and the OAuth routes of
  record 0226 answer `404`, as an unknown route does.
- The transport is stateless Streamable HTTP of the MCP revision 2026-07-28.
  The server also answers the earlier stateless form that the SDK serves. It
  keeps no session, so any replica answers any request. It answers JSON and
  opens no event stream.
- `@modelcontextprotocol/server` is the one MCP library. Only `apps/server`
  imports it, in `apps/server/src/mcp/`.
- The contract declares the endpoint with the protocol marker `mcp`, the
  security scheme `mcpAccessToken` with its two scopes, and the Protected
  Resource Metadata operation (RFC 9728) at the well-known path of the
  resource and at the root.
- A request without a valid token answers `401` with a `WWW-Authenticate`
  header that names the metadata address and both scopes.
- A request that carries an `Origin` header answers `403` unless that origin
  is the MCP origin or an application origin.
- The endpoint accepts only an access token of record 0226 whose resource is
  this endpoint. It refuses a session cookie and a personal key.
- The server offers tools only. No resource, prompt, sampling, elicitation,
  task or MCP App.
- This record replaces the stdio adapter of record 0008. The deletion that
  record 0008 decided stands.

## Consequences

- A self-hosted operator turns MCP on with one setting, and the cloud adds a
  host. The image keeps its two commands (record 0202).
- MCP traffic shares the replicas of the application. The bounds of
  record 0227 keep it from taking them.
- Integration tests run the official MCP conformance suite against the served
  endpoint, and prove the `401` challenge, the `Origin` refusal, the refusal
  of a cookie and a key, and that no MCP or OAuth route answers with no
  setting.
