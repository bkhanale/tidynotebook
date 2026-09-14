# 0031. The reader path is a closed read-only boundary

- Status: Accepted
- Date: 2026-09-14

## Context

Decision 0030 gives a stranger a link. The cheap way is a verified `Actor` for
the owner, reusing every read use case. That moves the one rule that keeps user
input out of the domain: `packages/core/src/identity/actor.ts` marks an `Actor`
with a symbol that only `verifyActor` sets, and `tools/actor-brand/fixture.ts`
holds that at compile time. A scoped actor still satisfies a write use case. See
[design 008](../design/008-published-read-only-links.md).

## Decision

The reader path is a closed set beside the account path. It never reaches
`requireActor`, and four independent refusals make a write impossible.

1. **The contract.** The published operations in
   `packages/api-contract/openapi.yaml` declare an empty security requirement,
   so `registerOperations` in `apps/server/src/plugins/register.ts` runs no
   identity resolver. A handler that called `requireActor` would refuse.
2. **The type.** The published route file under `apps/server/src/routes/`
   imports no actor helper, so it holds no `Actor` and no write use case
   compiles in it.
3. **The port.** The publication context of `packages/core` has a port that
   declares read methods only, so there is no write method to call.
4. **The database.** The publication unit of work in
   `packages/storage-server/src/workspace-store/` marks its transaction read
   only, so PostgreSQL refuses a write when every layer above fails.

Rendering reuses the one sanitized renderer. The published page is HTML that the
server builds with `renderMarkdown`, under the URL policy of
`packages/markdown/src/policy.ts`. This is the reader that decision 0025 named
when it superseded 0003. The web application injects no HTML, so the ban in
`apps/web/AGENTS.md` stands, and the page uses the built application stylesheet
only, so it cannot drift from the theme.

An image resolves through the `attachmentHref` option of the renderer, and the
server serves it only when the note that names it is in scope and references
that revision now. A link to a note in scope resolves to the published path. A
link outside it renders as plain text, through the blocked-destination path that
`applyUrlPolicy` in `packages/markdown/src/render.ts` already takes, so the page
never discloses a private note and never offers a sign-in screen. The reader
path counts nothing: no count, no per-reader record, no open log. A later task
that adds one changes this record first.

## Consequences

The product carries a second read path and a second unit of work. That
duplication buys a guarantee the compiler holds. The `text/html` row of
`mediaTypeHandling` in `register.ts` gets its first operation, so the size,
access and caching checks its comment promised are now due. `renderMarkdown`
gains its first production reader, and
`tests/integration/markdown-equivalence.test.ts` keeps it equal to the live
preview. A Mermaid fence stays a placeholder, because the diagram frame belongs
to the shell. A browser journey opens a link with no session and proves that no
write can be reached.
