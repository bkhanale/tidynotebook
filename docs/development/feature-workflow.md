# Developing a feature

This page is the recipe for one feature, from the contract to the merge. Work
in the order below. Each step names the directory that owns it, and each of
those directories has an `AGENTS.md` with its own rules. **Read the
`AGENTS.md` of a directory before you edit under it.**

An architectural choice needs a decision record first. See
[docs/decisions](../decisions/README.md).

## Where does this go

| Feature kind                                  | Package                              |
| --------------------------------------------- | ------------------------------------ |
| A new or changed HTTP operation               | `packages/api-contract/openapi.yaml` |
| A domain rule, a limit, a storage port        | `packages/core`                      |
| A PostgreSQL table, query, or migration       | `packages/storage-server`            |
| A route handler, headers, static files        | `apps/server`                        |
| An IndexedDB table or transaction             | `packages/storage-browser`           |
| A queue, lease, or offline rule               | `packages/sync`                      |
| A screen, a route, a React feature            | `apps/web/src/features`              |
| A shared control, layout, icon, theme         | `packages/ui`                        |
| Markdown syntax, sanitizing, URL policy       | `packages/markdown`                  |
| Editor decoration, widget, command            | `packages/editor`                    |
| The generator or the contract check           | `tools/sdk-codegen`                  |
| An end to end journey or a real database test | `tests`                              |

## a. The contract first

`packages/api-contract/openapi.yaml` is the only source of the HTTP
interface. Write the operation there before you write any code that uses it.
The full detail is in [Adding an API operation](api-contract.md). The rules
that generation enforces:

- The `operationId` is `camelCase`, stable, and never reused.
- Every parameter states `in`, `required`, `style`, `explode`, a description,
  and a schema. A query parameter uses `form` with `explode: true`. A path or
  header parameter uses `simple`. A cookie parameter is refused.
- A write body object sets `additionalProperties: false`.
- A member that only a client sends is `writeOnly`. A member that only the
  server produces is `readOnly`.
- Every operation declares its success status, `400`, and `500`. An operation
  with a request body also declares `413` and `415`.
- Every error uses `application/problem+json` with `ProblemDetails` and a
  stable `code`. One status carries one media type.
- No orphan component. `tools/sdk-codegen/src/orphans.ts` walks the merged
  document from the paths and the document security, and it fails on a
  component that nothing reaches.

Then run `pnpm contract:lint` and `pnpm generate`, and commit the generated
output with the contract. Never edit a file under a `src/generated/`
directory.

## b. The domain rule in `packages/core`

`packages/core` holds the rules that both runtimes share. It imports no
workspace package, no Node built in module, no database driver, no HTTP
framework, and no React.

1. Add the use case as a pure function, for example under `src/files/`.
2. When the use case needs stored data, add the method to the port in
   `src/files/ports.ts` (`WorkspaceStore`, `WorkspaceTransaction`) or to
   `src/workspaces/ports.ts`. The port is an interface. `packages/core`
   never implements it.
3. Export the new names from `src/index.ts`.
4. Add `src/<area>/<name>.test.ts` with `node:test` and `node:assert/strict`.
   A unit test proves the rule, including the refusal path.

## c. The storage implementation in `packages/storage-server`

1. Implement the port method in `src/workspace-store.ts` or the store that
   owns the area. Every write runs inside `transact`, which opens one
   transaction, sets the actor identity for that transaction only, and takes
   the workspace advisory lock. A SQL function that reads or writes workspace
   data carries its own membership check.
2. A schema change needs a migration. Edit `src/schema.ts`, run
   `pnpm db:generate`, and review the emitted file. The directory holds one
   initial migration, `migrations/0000_initial.sql`, and numbered follow ups.
   Never edit an applied migration; add the next number instead. Raise
   `requiredSchemaVersion` in `src/migrate.ts` to the new number of entries in
   `migrations/meta/_journal.json` in the same change, because the readiness
   probe compares the two.
3. Add the integration test under `tests/integration/`. It runs against the
   real PostgreSQL service from `compose.test.yaml`. Start the service once
   with `tools/test-database/ensure-postgres.sh`, then run
   `pnpm test:integration -- <name>`. A storage test must prove the row
   access rule as well as the result.

## d. The handler in `apps/server`

`createHandlers` in `apps/server/src/http/handlers.ts` returns one function
per operation id. A missing handler and an unknown handler both stop startup,
so the server cannot drift from the contract. Put the body of the handler in
the file of its area, for example `src/http/files.ts`. A handler reads its
validated input, calls the `packages/core` use case with the store, and
returns a status, a media type, and a body. It declares no route, no request
shape, and no response shape.

## e. The client side

1. When the feature works offline, add the local record to
   `packages/sync/src/local-port.ts` first, then implement it in
   `packages/storage-browser` with a Dexie table. A new IndexedDB table or
   index needs a new entry in `schemaVersions` in `src/database.ts`, and the
   record upgrade for it in `src/migrations.ts`. `currentSchemaVersion` is
   the highest entry, so it follows on its own.
2. Add the React feature under `apps/web/src/features`. It calls a generated
   operation from `@notesapp/api-client`. It never builds a URL and never
   calls `fetch`.
3. Build the screen from the `packages/ui` primitives (Page, PageHeader,
   Card, Dialog, EmptyState, ListRow) and Tailwind utilities. Colour comes
   from the theme registry only.
4. Keep testable logic out of the `.tsx` file. Put it in a `.ts` file next to
   it with its own `.test.ts`, as `save-state.ts` and `note-name.ts` do.

## f. Markdown and editor work

`packages/markdown` is the only definition of the language. A syntax change,
a sanitizer change, or a URL policy change goes there.

`packages/editor` keeps the Markdown source as the CodeMirror document and
builds every decoration from the Lezer syntax tree through
`syntaxTree(state)`. There is no second scanner and no second grammar. A
widget is allowed only for an image, a Mermaid diagram, or display math.

Any change to either side must keep the two paths equal. The corpus document
in `packages/markdown/test-data/content.ts` is rendered through both paths in
`tests/integration/markdown-equivalence.test.ts`, and the two results must
agree on structure.

## g. Verification

| When            | Command                                                       |
| --------------- | ------------------------------------------------------------- |
| While you work  | `pnpm test:unit -- <name>`, `pnpm test:integration -- <name>` |
| Before you land | `pnpm verify`                                                 |
| At release time | `pnpm test:e2e`                                               |

`pnpm verify` runs contract lint, the generated file comparison, typecheck,
lint, format check, unit tests, integration tests, and every build. `pnpm
lint` also runs `tools/check-versions.mjs`, `tools/check-boundaries.mjs`,
`tools/check-agents-md.mjs`, and `tools/check-design-rules.mjs`.

Every P0 journey needs a browser test that uses the public interface and
checks the server result. Run the matrix when navigation, persistence,
keyboard behaviour, or editor rendering changes.

## h. Landing the change

```bash
git worktree add ../notesapp-wt/my-change -b my-change main
cd ../notesapp-wt/my-change
pnpm install --frozen-lockfile --prefer-offline
# work, commit in small conventional commits
pnpm verify
git rebase main
git -C ../../notesapp merge --ff-only my-change
git worktree remove ../notesapp-wt/my-change
git branch -d my-change
```

If the rebase changed anything, run the checks again before you merge. Never
force push.

## Definition of done

- [ ] The contract change is in `openapi.yaml`, and the generated output is
      committed with it.
- [ ] The domain rule is in `packages/core` with a unit test for the accepted
      path and for the refusal.
- [ ] The storage change has a migration, a raised `requiredSchemaVersion`,
      and an integration test against real PostgreSQL.
- [ ] The handler exists for every new operation id, and the operation
      coverage test passes.
- [ ] The screen uses generated operations, `packages/ui` primitives, and
      theme tokens only.
- [ ] Every fixed defect has a regression test that fails before the fix.
- [ ] User facing text follows [the copy rules](../../rules/08-copy.md). No
      identifier, timestamp, error code, or engine notice reaches the person.
- [ ] An architectural choice has a decision record in `docs/decisions`.
- [ ] The `AGENTS.md` of each directory you edited still describes the truth.
- [ ] `pnpm verify` passes, and the browser tests for the touched journeys
      pass.
