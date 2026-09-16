# Plan 007: Published read-only links

Status: complete

> The live prioritized list is the
> [GitHub project board](https://github.com/users/bkhanale/projects/2).

This plan turns [design 008](../design/008-published-read-only-links.md) and its
records into ordered work. The order is the repository feature order of
[the feature workflow](../development/feature-workflow.md): the contract, the
domain rule, the storage and the migration, the handler, the client, then the
verification. Each item names the file it creates or edits, the record it
answers, and its acceptance. An agent can work from this page without reading
the design.

## Decisions

- [0030. A published link is a hashed token over a read-only scope](../decisions/0030-published-links-are-hashed-tokens-over-a-scope.md)
- [0031. The reader path is a closed read-only boundary](../decisions/0031-the-reader-path-is-a-closed-read-only-boundary.md)
- [0046. The reader carries its credentials in the address](../decisions/0046-the-reader-carries-its-credentials-in-the-address.md)
- [0047. The published page always answers a page](../decisions/0047-the-published-page-always-answers-a-page.md)
- [0048. Publish is a command and the links are one workspace list](../decisions/0048-publish-is-a-command-and-the-links-are-a-list.md)
- Kept: [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
- Kept: [0018. The directory structure follows ports and adapters](../decisions/0018-directory-structure-by-layer.md)
- Kept: [0019. One contract, generated types, and no type assertions](../decisions/0019-contract-validation-and-shared-types.md)
- Kept: [0005. Workspace is an implicit container](../decisions/0005-workspace-is-an-implicit-container.md)
- Kept: [0011. Shared contract definitions and one initial migration](../decisions/0011-contract-emit-and-one-migration.md)

## Dependency on the rate limit row

`apps/server/src/plugins/` holds no rate limit today. The board row "Rate limit
the setup and the authentication routes", issue #2, owns that plugin and is
already in progress. This plan adds no second throttle. Items 2, 20 and 32 carry
the password, and they ship only after issue #2 lands and they reuse its plugin.
Every other item ships without waiting, because a link with no password needs no
throttle.

## A. The contract (0030, 0031)

1. In `packages/api-contract/`, add the owner operations: create a
   link, list the links of a workspace, revoke a link. They keep the default
   session security. Acceptance: the create answer holds the token exactly once,
   and no other answer holds it.
2. In the same place, add the reader operations, each with an empty security
   requirement: unlock a link, read the published page, read a published
   attachment. The page answers `text/html`. The attachment address names the
   token, the note, and the attachment revision. Acceptance: a reader operation
   declares no security scheme, so `registerOperations` runs no identity hook
   for it. Unlock waits on issue #2.
3. In the same file, declare one refusal shape for every reader failure.
   Acceptance: a missing link, a revoked link, an expired link, and a wrong
   password answer with the same status and the same problem code, and the body
   names no note, no folder, and no owner. Record 0047 refines this for the
   page, which answers one document for every state instead.
4. Run `pnpm contract:lint` and `pnpm generate`. Commit the generated output
   with the contract. Never edit a file under a `src/generated/` directory.

## B. The domain rule in `packages/core` (0030, 0031)

5. Create `packages/core/src/publications/` with `model.ts`, `ports.ts`,
   `errors.ts`, and one use case per file, as decision 0018 states. The port
   declares read methods only. Acceptance: no port method writes, and no use
   case of this context takes an `Actor`.
6. In `packages/core/src/publications/ports.ts`, add the password hasher port
   and the token digest rule. Acceptance: the hasher is an interface, and
   `packages/core` imports no hashing library.
7. In `packages/core/src/publications/model.ts`, add the link limit as one named
   constant with the value 200, in the style of `maxFilesPerChangeset` in
   `packages/core/src/files/commit.ts`. Acceptance: a create past the limit is
   refused by a unit test.
8. Add the resolve use case under `packages/core/src/publications/`. It takes a
   token digest, a clock, and an optional ticket. It refuses a missing link, a
   revoked link, and an expired link with one error value. Acceptance: a unit
   test proves each refusal, and proves the three are equal at the boundary.
9. Add the ticket rule under `packages/core/src/publications/`. A ticket is
   bound to one link, lives 12 hours, and reading does not refresh it.
   Acceptance: a unit test proves that a ticket read at hour 11 still works, a
   ticket read at hour 13 does not, and that a read does not move the expiry.
10. Add the scope rule under `packages/core/src/publications/`. It answers
    whether a note path is inside the scope of a note link or a folder link.
    Acceptance: a unit test proves that a sibling folder with the same name
    prefix is out of scope, and that a note in the Trash is out of scope.
11. Add the listing rule under `packages/core/src/publications/`. A folder link
    lists every note below it. Acceptance: a unit test proves the list holds
    every descendant and nothing else.
12. Add the attachment reference rule under `packages/core/src/publications/`.
    It answers whether the current content of an in-scope note references an
    attachment revision. Acceptance: a unit test proves that an attachment named
    only by a note outside the scope is refused.
13. Export the new names from `packages/core/src/index.ts`. Do not export any
    value that could build an actor.

## C. The storage and the migration (0030, 0031)

14. Add the publication table to `packages/storage-server/src/schema.ts`. It
    records the token digest, the owner, the workspace, the scope, the optional
    password digest, the optional expiry, and the revocation. Run
    `pnpm db:generate` and review the emitted file. Add the next numbered
    migration under `packages/storage-server/migrations/` and never edit an
    applied one, as decision 0011 states.
15. Add the reading ticket table in the same migration, holding a ticket digest,
    its link, and its expiry. Acceptance: no raw ticket and no raw token is
    stored anywhere.
16. Raise `requiredSchemaVersion` in `packages/storage-server/src/migrate.ts` in
    the same change. Acceptance: `tests/integration/schema-version.test.ts`
    passes.
17. Add the row-level policy of both new tables in the same migration, in the
    shape that `packages/storage-server/migrations/0000_initial.sql` uses for
    the workspace tables. Acceptance: `tests/integration/row-access.test.ts`
    gains a case that one account cannot read the links of another.
18. Add the publication unit of work beside
    `packages/storage-server/src/workspace-store/transaction.ts`. It takes the
    owner account of the link, not an `Actor`, and it marks the transaction read
    only. Acceptance: an integration test proves the database refuses a write
    inside that transaction.
19. Add `packages/storage-server/src/workspace-store/publications-repository.ts`
    with an index on the token digest. Every read starts from the one query that
    bounds the scope. Acceptance: an integration test asks for a note outside
    the scope by its identifier and gets nothing, and the lookup reads one row.

## D. The handler in `apps/server` (0030, 0031)

20. Add the Better Auth hasher adapter under `apps/server/src/auth/`. It
    implements the port of item 6 over the context that
    `apps/server/src/cli/recover-account.ts` already uses. Acceptance: an
    integration test hashes and verifies through the adapter, so a library move
    fails the build. Waits on issue #2 only for its route, not for itself.
21. Create `apps/server/src/routes/publications.ts` for the owner operations. It
    calls `requireActor` like every other owner route. Register each handler in
    `apps/server/src/routes/handlers.ts`.
22. Create `apps/server/src/routes/published.ts` for the reader operations. This
    file imports no actor helper. Register each handler in
    `apps/server/src/routes/handlers.ts`. Acceptance: a test refuses an actor
    import in this file, and `createHandlers` returns every new handler.
23. Implement the `html` branch of `mediaTypeHandling` in
    `apps/server/src/plugins/register.ts`, as its own comment asks, with the
    size, access and caching checks. Acceptance: a published page answer carries
    a private cache directive and no shared cache stores it.
24. Build the published document in `apps/server/src/routes/published.ts`. The
    body comes from `renderMarkdown` in `packages/markdown`. Acceptance: a
    `<script>` block, an `onerror` attribute, and an external image in the note
    source do not reach the reader.
25. Resolve the stylesheet of the published document. Read the stylesheet link
    of the built shell document, through the same modification-time cache that
    `documentContentPolicy` in `apps/server/src/plugins/static-assets.ts` uses.
    `apps/web/vite.config.ts` emits no build manifest, so there is none to read;
    turning that option on is the alternative, and this item decided against
    it, because the server already parses that document for the inline script
    hashes of its content policy. Acceptance: the published page loads the one
    built application stylesheet, and no second stylesheet exists.
26. Add a note resolver beside the `attachmentHref` option in
    `packages/markdown/src/render.ts`. It answers with a published address for
    an in-scope note and with nothing for any other note. Acceptance: a link to
    a note outside the scope renders as plain text through the existing
    blocked-destination path of `applyUrlPolicy`, with no address and no
    sign-in screen.
27. Give the published document its own content policy in
    `apps/server/src/plugins/security-headers.ts`. Acceptance: the policy denies
    framing and allows no inline script.
28. Serve a published attachment in `apps/server/src/routes/published.ts` only
    after the server proves the token, the note in scope, and the reference.
    Acceptance: an address that names a valid token and an out-of-scope
    attachment is refused.
29. Add `apps/server/src/jobs/publication-cleanup.ts` beside `sync-cleanup.ts`
    and `attachment-cleanup.ts`, and call it from the existing hourly
    `runCleanup` in `apps/server/src/app.ts`. Acceptance: an expired or revoked
    record is removed, and no second scheduler and no timer is added. There is
    no Trash sweep to reuse, because record 0026 refused an auto-purge.

## E. The client (0030)

30. Add the publish action to the note surface and the folder menu under
    `apps/web/src/features/`. It calls a generated operation and builds no URL.
    Acceptance: the token is shown once with a copy action, and the screen says
    that it cannot be shown again.
31. Add the link list with Revoke and the optional expiry under
    `apps/web/src/features/`. Acceptance: Revoke removes the link at once, and
    the copy uses the product terms of the root `AGENTS.md`.
32. Add the optional password field to the publish dialog. Ships after issue #2.
33. Say on the folder publish dialog, before the person confirms, that a folder
    link lists and publishes every note name below it, now and later.
34. Keep the testable logic in a `.ts` file beside each component with its own
    unit test, as `apps/web/src/lib/note-name.ts` does. Acceptance: no rule of
    the publish screen sits only in a `.tsx` file.
35. Add no reader route to `apps/web/src/router.tsx`. The published page is a
    server document. Acceptance: `apps/web` gains no `innerHTML` host, so
    `tools/check-design-rules.mjs` stays unchanged.
36. Show the owner no reader count anywhere. Acceptance: no screen and no
    operation reports how many times a link was opened.

## F. Verification (0030, 0031)

37. Unit tests in `packages/core/src/publications/` for every refusal of items 7
    to 12.
38. Integration tests under `tests/integration/` against real PostgreSQL for
    items 14 to 19, including one that reads the tables directly and proves no
    working token and no working ticket is at rest.
39. Add to `tests/integration/contract.test.ts` a case that every reader
    operation declares an empty security requirement. Acceptance: a later change
    that guards a reader operation, or that opens an owner operation, fails.
40. Add `tests/e2e/published-link.spec.ts`: the owner publishes a note, the
    reader opens the link in a context with no session, reads the heading, the
    code, the task, the table, and the image, and the test checks the server
    result. Acceptance: the reader context holds no cookie of the product.
41. Extend that journey for a folder link: the reader sees the list of notes
    below the folder, opens a second note through an in-scope link, and finds an
    out-of-scope link rendered as plain text with no address.
42. Add a browser journey for the password: a wrong password refuses, the right
    password reads, and an unknown token refuses in the same words. Ships with
    item 32.
43. Add a browser journey for revocation and expiry: the reader loses access at
    once after Revoke, an expired link refuses, and a ticket past 12 hours asks
    for the password again.
44. Add a security test that sends each write operation with a published token
    and no session, and proves the server refuses and the note is unchanged.
45. Update `AGENTS.md` in `packages/core`, `packages/storage-server`,
    `apps/server`, `apps/web`, and `tests`, in the same commits that move those
    boundaries.
46. Add the reader page to `docs/guide/`. It starts with the sentence that names
    its reader, and it shows no identifier and no token shape.
47. Run `pnpm verify`, then the full browser matrix, because navigation,
    persistence, and rendering all change.
