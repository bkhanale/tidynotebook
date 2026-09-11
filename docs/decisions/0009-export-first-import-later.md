# 0009. Export first, import later

- Status: Accepted
- Date: 2026-09-10

## Context

The product promise is that nothing is stored that cannot be exported as
plain Markdown files. Export proves the promise. Import is a larger problem,
because it must decide paths, name collisions, and attachment references.

## Decision

Export of one note or of all notes as `.md` files in a zip is in v0.1.
Import of `.md` files is v0.2, unless it proves trivial after export lands.

## Consequences

- The export path in `apps/server/src/http/export.ts` and `zip.ts` is the
  v0.1 proof of the promise, and it has integration tests.
- A person can leave the application at any time.
- No import user interface is built in v0.1.
