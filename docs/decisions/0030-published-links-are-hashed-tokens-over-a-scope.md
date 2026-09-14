# 0030. A published link is a hashed token over a read-only scope

- Status: Accepted
- Date: 2026-09-14

## Context

No path of this product serves a person who has no account. Every route file
under `apps/server/src/routes/` starts at `requireActor` in
`apps/server/src/auth/actor.ts`, and the root security block of
`packages/api-contract/openapi.yaml` guards every operation except the service
probes and the first-run setup. A person who shows a note copies its text out,
so the note stops being the source. See
[design 008](../design/008-published-read-only-links.md).

## Decision

A published link is one record in `packages/core`, served by a repository in
`packages/storage-server` and one migration.

- The link carries an opaque random token. The token is never a note
  identifier and never a folder path, so an identifier that leaks does not
  become a link.
- The server stores only a fast digest of the token, and the token appears once
  in the URL that the owner copies, so a read of the database yields no working
  link. The digest is not the password hasher, because the token holds full
  entropy already and the lookup needs an index.
- The scope is one note, or one folder and every note below it. A folder is a
  part of a note path under decision 0005, so the scope is a path prefix inside
  one workspace. The scope lives in the SQL of the publication repository, so no
  caller can forget it. A note in the Trash is out of scope.
- A folder link lists the notes below it, so it publishes every note name below
  it, now and later. The create dialog says so before the person confirms.
- The password is optional and belongs to one link. It reuses the hasher of the
  account path, which `apps/server/src/cli/recover-account.ts` reaches through
  the Better Auth context, and `packages/core` takes as a port. No second
  hashing scheme enters the product.
- The unlock answer is a reading ticket bound to that link, stored as a digest
  and carried by the reader in each published call. It lives 12 hours and
  reading does not refresh it. No cookie is set.
- A link is revocable and carries an optional expiry. The server reads the link
  record on every published request, so revocation takes effect at once.
- A workspace holds at most 200 links, as one named constant beside the
  publication use cases, like `maxFilesPerChangeset` in `files/commit.ts`.
- Every refusal is the same refusal. A missing link, a revoked link, an expired
  link, and a wrong password give one answer that names no note and no owner.

## Consequences

The product gains its first record whose loss is a disclosure, so the migration
and the repository carry the strictest tests in the tree. The password reuses
the shared rate limit plugin of the board row that owns it, and ships only after
that row lands; a link with no password does not wait. An expired or revoked
record is removed by the hourly cleanup that `apps/server/src/app.ts` already
runs. No second scheduler is added, and no Trash sweep is reused, because record
0026 refused an auto-purge. An integration test shaped like
`tests/integration/row-access.test.ts` proves that a link reaches nothing
outside its scope, and a second proves that a wrong password and an unknown link
answer alike.
