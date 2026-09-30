# 0135. An identity is keyed by its provider and its account

- Status: Accepted
- Date: 2026-10-01

## Context

Better Auth 1.7.0 to 1.7.2 wrote an `issuer` on each account row, and
`auth_account` took it as a required column and as the first column of its
unique key (`packages/storage-server/src/schema.ts`). Better Auth 1.7.3 takes
the issuer out again: an account is keyed by its provider and its account
identifier, as in 1.6, and the library never writes an issuer. The same
release checks the schema of the adapter before the first query, and a
required column that the library never writes stops every sign-up, sign-in
and session read. Design 015 kept the issuer column for a later external
provider. This installation has none: every account is a password
credential.

## Decision

- Migration `0021_auth_account_provider_key.sql` drops the key, then drops
  `auth_account.issuer`, then keys the table by `provider_id` and
  `account_id`. The old key goes first, so no index stays on the remaining
  columns.
- The schema follows the key that Better Auth writes. No column exists that
  the library never writes.
- Account linking stays off, so a matching address still never joins two
  identities.
- An external provider is a design of its own. It states how that provider
  keeps two issuers apart, for example with one provider identifier for each
  issuer.

## Consequences

- better-auth 1.7.3 and later run against this schema, and the schema check
  of the library passes.
- A credential account keeps its row through the migration, because its
  provider and account identifier were unique already.
- The integration tests that make an account, sign in and read a session hold
  the key. `tests/integration/auth-account-key.test.ts` proves that an account
  made before the migration still signs in after it.
