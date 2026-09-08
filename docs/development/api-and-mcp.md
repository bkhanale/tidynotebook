# API and MCP Access

This document specifies the notesapp Model Context Protocol (MCP) access
interfaces and their relation to the HTTP API.

## Overview

Notesapp exposes two authenticated MCP adapters:

1. **Remote MCP**: A Streamable HTTP endpoint mounted at `/mcp` on Fastify.
   This transport serves external AI agents and orchestration environments.
2. **Local MCP**: A command-line program at `apps/mcp-stdio` that communicates
   through standard input and output (`stdio`). It translates JSON-RPC requests
   into HTTP calls through `@notesapp/api-client`.

Both adapters share identical tool schemas, security constraints, and domain
preconditions.

## Architecture and Endpoints

| Endpoint                                    | Method                  | Protocol        | Purpose                                            |
| :------------------------------------------ | :---------------------- | :-------------- | :------------------------------------------------- |
| `/.well-known/oauth-protected-resource/mcp` | `GET`                   | RFC 9728        | Protected resource metadata for MCP clients.       |
| `/.well-known/oauth-authorization-server`   | `GET`                   | RFC 8414        | Authorization server metadata.                     |
| `/oauth/authorize`                          | `GET`                   | RFC 6749 / 7636 | User consent and PKCE authorization code issue.    |
| `/oauth/token`                              | `POST`                  | RFC 6749 / 7636 | Code exchange for bounded access tokens.           |
| `/mcp`                                      | `POST`, `GET`, `DELETE` | Streamable HTTP | Streamable HTTP transport for remote MCP sessions. |

## OAuth 2.0 and Authentication

### Protected Resource Metadata (RFC 9728)

Clients can inspect the protected resource metadata at:
`/.well-known/oauth-protected-resource/mcp`

The server responds with:

- `resource`: The canonical resource URI (e.g. `http://127.0.0.1/mcp`).
- `authorization_servers`: List containing the issuer origin.
- `scopes_supported`: List of supported scopes (`notes:read`, `notes:write`).
- `bearer_methods_supported`: `["header"]`.
- `resource_documentation`: URL to MCP documentation.

When an unauthenticated request reaches `/mcp`, the server challenges the
client with HTTP 401 Unauthorized and includes the `WWW-Authenticate` header
containing `resource_metadata`.

### Authorization Server Metadata (RFC 8414)

Clients inspect authorization capabilities at:
`/.well-known/oauth-authorization-server`

The server publishes:

- `issuer`: The base origin.
- `authorization_endpoint`: `/oauth/authorize`.
- `token_endpoint`: `/oauth/token`.
- `response_types_supported`: `["code"]`.
- `grant_types_supported`: `["authorization_code"]`.
- `code_challenge_methods_supported`: `["S256"]`.
- `token_endpoint_auth_methods_supported`: `["none", "client_secret_post", "client_secret_basic"]`.

### PKCE Authorization Code Flow

Public and confidential clients obtain bound access tokens through PKCE:

1. **Authorization Request**:
   The client directs the user to `/oauth/authorize` with:
   - `client_id`: Registered client identifier.
   - `redirect_uri`: Validated redirect URI.
   - `response_type`: Must be `code`.
   - `code_challenge`: SHA-256 base64url challenge of the verifier.
   - `code_challenge_method`: Must be `S256`.
   - `resource`: Target resource URL (`/mcp`).
   - `scope`: Space-separated scope list.

   If the user has an active session cookie, the server issues a single-use
   authorization code with a 10-minute expiry and redirects to the callback URI.

2. **Token Exchange**:
   The client submits a `POST /oauth/token` request with
   `application/x-www-form-urlencoded` body:
   - `grant_type`: `authorization_code`.
   - `client_id`: Matching client identifier.
   - `code`: Single-use authorization code.
   - `redirect_uri`: Matching redirect URI.
   - `code_verifier`: Plaintext PKCE verifier (minimum 43 characters).
   - `resource`: Target resource identifier.

   The endpoint validates the SHA-256 hash against the code challenge, consumes
   the code, and returns an access token with expiry.

### Direct Agent Tokens

Users can also generate direct agent tokens through the HTTP API. Direct agent
tokens are bearer credentials with:

- Configurable expiry timestamp.
- Explicit workspace scoping.
- Action-level grants (`read`, `write`, `history`, `purge`).

## Per-Call Authorization and Security Checks

Every tool invocation over remote MCP and stdio MCP validates security state:

1. **Token Validity**: Checks that the token signature and format are correct.
2. **Revocation**: Checks that the token has not been revoked. Revocations take
   effect immediately on the next call.
3. **Expiration**: Verifies that `expiresAt` has not passed.
4. **Audience Binding**: Verifies that the token was issued for the target
   resource server origin.
5. **Workspace Access**: Confirms that the account can use the requested
   workspace.
6. **Action Grant**: Verifies that the actor role and token scope allow the
   requested operation action (`read`, `write`, `history`).

## The 14 MCP Domain Tools

The tools match the OpenAPI contract schemas:

| Tool Name           | Action    | Description                                  | Key Preconditions                 |
| :------------------ | :-------- | :------------------------------------------- | :-------------------------------- |
| `list_workspaces`   | `read`    | List workspaces accessible to the actor.     | None                              |
| `list_files`        | `read`    | List live non-deleted files in a workspace.  | `cursor`, `limit`                 |
| `get_file`          | `read`    | Get file metadata and current head revision. | File exists                       |
| `create_file`       | `write`   | Create a new file with initial content.      | Path does not exist               |
| `update_file`       | `write`   | Update content or path of an existing file.  | `expectedRevisionId` matches head |
| `delete_file`       | `write`   | Mark a file as deleted with a tombstone.     | `expectedRevisionId` matches head |
| `list_history`      | `history` | List historical revisions of a file.         | File exists                       |
| `get_revision`      | `history` | Retrieve a specific immutable revision.      | Revision exists                   |
| `create_checkpoint` | `write`   | Create a named checkpoint on current head.   | `expectedRevisionId` matches head |
| `restore_revision`  | `write`   | Restore an older revision as the new head.   | `expectedRevisionId` matches head |
| `upload_attachment` | `write`   | Store binary attachment content (base64).    | Allowed media type                |
| `get_attachment`    | `read`    | Retrieve attachment content (base64).        | Revision exists                   |
| `search_files`      | `read`    | Full-text search across accepted notes.      | Valid query string                |
| `get_backlinks`     | `read`    | Find notes that reference a target file.     | Target file exists                |

## Preconditions and Linear History

Agents must handle concurrency without losing work:

- **Optimistic Concurrency**: Mutating tools (`update_file`, `delete_file`,
  `create_checkpoint`, `restore_revision`) require `expectedRevisionId`.
- **Ordered Updates**: The server places a stale explicit update after the
  current head. A create that finds an existing file still fails its
  precondition.

## Local Stdio MCP CLI

The local stdio MCP CLI is packaged at `apps/mcp-stdio`:

- **Execution**: Run with `pnpm mcp:stdio`.
- **Configuration**:
  - `NOTESAPP_ORIGIN`: Base URL of the notesapp server.
  - `NOTESAPP_TOKEN`: Bearer agent token for authentication.
- **Standard I/O Discipline**:
  - `stdout`: Strictly reserved for JSON-RPC messages.
  - `stderr`: Informational status and diagnostics only.
  - Command-line arguments never expose secret tokens.
