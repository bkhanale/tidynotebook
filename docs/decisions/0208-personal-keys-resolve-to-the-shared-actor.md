# 0208. Personal keys resolve to the shared actor

- Status: Accepted
- Date: 2026-10-07

## Context

A program needs a credential apart from a browser session. A CLI and future
agent tools must reuse the contract and domain rules. See
[design 025](../design/025-personal-api-keys.md).

## Decision

- An opaque personal API key uses the HTTP bearer header. Only its SHA-256
  digest reaches storage. Creation returns the secret once, with no cache.
- The credential resolver selects the explicit bearer header before the
  cookie. A refused header never falls back. It reads the account and current
  rights and builds the same verified actor for either credential.
- Keys have full account access, a name, an expiry and a bounded count. Key
  management uses the same account transaction and generated API. Narrow
  database functions bind each write to the account and enforce the bound.
- Revocation takes effect on the next request. A disabled or removed account
  and a password change remove its keys. A locked account keeps key listing
  and revocation as credential controls, which refines record 0201.
- Session lifecycle and browser notice streams remain session operations.
  All durable application operations accept either credential. A profile
  change becomes a contract handler at its existing path and operation id,
  instead of a Better Auth protocol operation. This refines record 0019 and
  the authentication fragment without changing the client interface.
- A future CLI uses the generated client. A future remote MCP issuer needs
  OAuth consent and resolves into this actor layer. No CLI or MCP server is
  added by this change, as record 0008 keeps unused adapters out.

## Consequences

No second application API or rights matrix is added. A key can perform all
account actions, so the person must keep it private and use HTTPS. A database
copy holds no working key. The operator API is unchanged. Tests cover both
credentials, their isolation and invalidation, and the visible key controls.
