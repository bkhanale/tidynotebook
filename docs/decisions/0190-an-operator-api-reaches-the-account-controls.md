# 0190. An operator API reaches the account controls

- Status: Accepted
- Date: 2026-10-04

## Context

The billing service of record 0186 is a separate program. It must set the
controls of record 0189, know which person opened it, and learn when an
account is made or removed. Today every operation of the contract needs a
session of a person. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `NOTESAPP_OPERATOR_TOKEN_FILE` names a file that holds one operator secret.
  With no setting, every operator operation answers 404 `operator_off`.
- The contract declares a security scheme `operatorToken`, a bearer token. The
  operator operations live under `/api/operator/` and take no session. The
  server compares the token in constant time, and the attempt counters of
  record 0121 bound the failures.
- The operations: find an account by identifier or address, read its controls
  and its usage, set its controls, remove it through record 0111, redeem a
  handoff, and list account events after a cursor.
- **The handoff.** The operation `openAccountPortal` takes the session of a
  person and a path on the portal. It makes a single-use token that expires
  after `60 s`, stores only its hash, and answers that path of
  `NOTESAPP_ACCOUNT_PORTAL_URL` with the token in the query. The service redeems it through the operator API and
  learns the account and its address. A token works once.
- **The account events.** The core keeps one event row when an account is
  made, verified or removed. The service reads the rows after its own cursor.
  The core sends nothing out, so a self-hosted installation stays silent.
- The operator operations skip the Host allowlist of record 0039, as the
  probes of record 0199 do, because a service on a private network names the
  core by an internal host. They set no cookie and answer no page.
- The operator API never reads or writes a note, a workspace or a published
  link.

## Consequences

- A service can manage accounts with no database role and no shared code.
- Integration tests prove that a wrong or missing token changes nothing, that
  a handoff works once and expires, that the event cursor misses no event,
  and that no operator operation reaches a note.
