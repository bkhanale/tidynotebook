# Personal API keys
Status: active

A person must be able to use a program to read and change the same account
that they use in the browser. A future command line client and an agent tool
must use the same operations. The current contract, generated client, actor,
domain rules and database policies already form that common layer. The missing
part is a credential that a program can present without a browser cookie.

## Options

A program can use a session cookie, but a cookie is tied to browser sign-in
and the checks that prevent a page from making a foreign write. Sharing that
cookie also shares a device credential. It gives the person no separate name,
expiry or revoke control for a program.

A personal API key gives a program a separate credential. The server creates
an opaque random secret, shows it once, and stores only its hash. It accepts
the secret through the standard HTTP bearer header. The key resolves to the
same account and current rights as a session. The cost is a small credential
store and controls to create and revoke keys. This is the selected option.

OAuth gives a third party a consent flow and short lived access tokens. It is
the right later choice for a remote MCP service that acts for other people.
It needs a client registry, redirect checks, consent and token exchange. Those
parts have no caller in this feature. The future issuer can resolve to the
same actor without a second application API.

## Access and lifetime

A key has full access to its account, including account administration when
its owner has that role. The key does not freeze rights. Each request reads
the enabled account, standing and workspace membership. The domain and
database still check rights for the operation. An operator token and a
published link retain their separate boundaries.

Each key has a name and an expiry. Creation and retention have a fixed bound.
A person can revoke a key at once, and rotate it by making a replacement before
revoking the old one. Disabling or removing the account removes its keys.
A password change or recovery removes keys too. A failed bearer header never
falls back to a session cookie. Tokens never travel in a URL, log, or list.

The bearer transport needs no browser origin for a write. Cookie writes keep
their origin check. Session sign-in, sign-out and browser notice streams stay
session operations. Programs use durable HTTP sync and can end sessions by
their identifiers. Profile changes use an application operation for both
credentials. The browser uses the generated key operations and shared controls.

## Verification

Tests prove key input and lifetime rules, the shared actor, database isolation,
the credential bounds, expiry, revoke, account and password invalidation, and
the served result through the generated client. Browser checks prove creation,
copy, list and revoke, keyboard use, and both colour schemes. The full gate
must pass before landing. Issue [293](https://github.com/tidynotebook/tidynotebook/issues/293)
holds this work on the board.

## Sources

[RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) defines the bearer header.
[OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
states transport and access checks.

## Decisions

- [0208, personal keys resolve to the shared actor](../decisions/0208-personal-keys-resolve-to-the-shared-actor.md).
