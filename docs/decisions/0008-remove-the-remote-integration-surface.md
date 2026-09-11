# 0008. Remove the remote integration surface for v0.1

- Status: Accepted
- Date: 2026-09-10

## Context

The repository carried a remote MCP server, an OAuth authorization server,
agent tokens, an `apps/mcp-stdio` application, a `/metrics` route, and a
write pause. No person used any of them. The dead surface kept its own
contract operations, its own tests, and its own failure modes.

## Decision

All of that code is deleted, not flagged and not disabled. MCP returns in
v0.2 as a stdio adapter with a manually issued token, on top of the same
contract.

## Consequences

- The contract, the client, and the handler map get smaller together.
- A feature that is not used is deleted rather than kept behind a flag.
- A v0.2 stdio adapter reuses the existing operations, so no new transport is
  needed.
