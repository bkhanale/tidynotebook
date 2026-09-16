# Plan 010: Workspaces as an explicit container

Status: active

> The live prioritized list is the
> [GitHub project board](https://github.com/users/bkhanale/projects/2).

This plan turns [design 010](../design/010-workspaces-as-an-explicit-container.md)
and its records into ordered work. The order is the repository feature order of
[the feature workflow](../development/feature-workflow.md): the contract, the
domain rule, the storage and the migration, the handler, the client, then the
verification. Each item names the file it creates or edits, the record it
answers, and its acceptance. An agent can work from this page without reading
the design.

## Decisions

- [0049. A workspace is an explicit container that a person chooses](../decisions/0049-a-workspace-is-an-explicit-container.md)
- [0050. Every workspace with queued work keeps syncing](../decisions/0050-every-workspace-with-queued-work-keeps-syncing.md)
- [0051. An account always keeps one workspace](../decisions/0051-an-account-always-keeps-one-workspace.md)
- Superseded: [0005. Workspace is an implicit container](../decisions/0005-workspace-is-an-implicit-container.md)
- Kept: [0018. The directory structure follows ports and adapters](../decisions/0018-directory-structure-by-layer.md)
- Kept: [0019. One contract, generated types, and no type assertions](../decisions/0019-contract-validation-and-shared-types.md)
- Kept: [0035. The sidebar width belongs to the person](../decisions/0035-the-sidebar-width-belongs-to-the-person.md)
- Kept: [0036. The browser gate runs in parallel workers](../decisions/0036-the-browser-gate-runs-in-parallel-workers.md)

## What is already built

The server side of many workspaces per account ships today and needs no change
for records 0049 and 0050. `packages/api-contract/paths/api_workspaces.yaml`
and `api_workspaces_workspaceId.yaml` declare the four operations,
`packages/core/src/workspaces/service.ts` holds the use cases with unit tests,
`apps/server/src/routes/workspaces.ts` holds the handlers, and
`notesapp_create_workspace` makes the caller the owner. Read those files before
item 1. This plan adds a contract operation for nothing, and it changes the
server only for record 0051.

## A. The domain rule in `packages/core` (0051)

1. In `packages/core/src/workspaces/ports.ts`, add the read that answers how
   many workspaces the account of the transaction belongs to, on
   `WorkspaceAdminTransaction`. Acceptance: the port stays an interface and
   names no driver.
2. In `packages/core/src/workspaces/service.ts`, make `deleteWorkspace` read
   that count inside the open transaction, after the owner check, and return
   `fail('forbidden')` when it is one. Acceptance: the count is read under the
   workspace lock that the transaction already holds.
3. In `packages/core/src/workspaces/service.test.ts`, add the accepted path and
   the refusal. Acceptance: the refusal names the exact `DomainErrorCode`, and
   the same delete succeeds when the in-memory double holds two workspaces.

## B. The storage and the migration (0051)

4. In `packages/storage-server/src/identity-store.ts`, implement the port read
   of item 1 on the workspace transaction. It counts the membership rows of the
   account of the transaction. Acceptance: the SQL names no account from a
   request body, only the account the transaction was opened with.
5. Add the next numbered migration under `packages/storage-server/migrations/`
   that replaces the body of `notesapp_delete_workspace`, so it raises when the
   calling account holds one membership. Never edit an applied migration.
   Acceptance: the function keeps its owner check and adds the count check.
6. Raise `requiredSchemaVersion` in `packages/storage-server/src/migrate.ts` and
   add the journal entry in the same change. Acceptance: the readiness probe
   agrees with the applied count.
7. In `tests/integration/identity.test.ts`, or a new
   `tests/integration/workspaces.test.ts`, prove that the database refuses the
   delete of the last workspace when the store is called directly, and accepts
   it when a second workspace exists. Acceptance: the test reads the real
   PostgreSQL service and asserts the rows that survive.

## C. The local store and the sync port (0050)

8. In `packages/sync/src/local-port.ts`, add the read that answers which
   workspaces of one account hold a queue entry. Acceptance: it takes the
   account only, and it returns workspace identifiers.
9. In `packages/storage-browser/src/local-store/queue.ts`, implement it over
   the account wide index that the queue table already carries. Acceptance: no
   schema version and no record upgrade is added, and the test in
   `tests/integration/browser-storage.test.ts` proves the answer holds a
   workspace with a queue entry and holds no workspace without one.
10. In `packages/sync/src/lease.ts`, state the shared lease rule in the module
    comment and add the test that two owners with one identifier both hold the
    lease while a third identifier does not. Acceptance: the test fails if the
    compare and set in
    `packages/storage-browser/src/local-store/preferences.ts` starts refusing
    the same owner.

## D. The client (0049, 0050, 0051)

11. Replace `useWorkspaceLoader` in `apps/web/src/app.tsx` with a loader that
    keeps the whole list and the chosen workspace. The offline fallback keeps
    the last known list of that account. Acceptance: the workspace value
    exposes the list, the open workspace, a switch, and a reload.
12. Add `apps/web/src/lib/workspace-choice.ts` with the stored choice of the
    device, its parse and its fallback, plus `workspace-choice.test.ts`. The
    fallback order is the stored choice, then the personal workspace, then the
    first one. Acceptance: a stored identifier that the list no longer holds
    falls back and does not error.
13. In `apps/web/src/shell/workspaces.tsx`, replace `RequireCurrentWorkspace`
    with a membership check. An address that names a workspace of the account
    opens it and becomes the stored choice. An address that names any other
    workspace goes to the chosen one. Acceptance: a link to a second workspace
    of the same account opens that workspace instead of bouncing to the first.
14. In `packages/ui/src/menu.tsx`, add the pinned row that stays in view while
    the list scrolls. Acceptance: the row keeps its place in the arrow key
    order, Escape still closes the menu, and focus still returns to the
    trigger.
15. In `apps/web/src/shell/workspaces.tsx`, add the switcher: a trigger that
    names the open workspace, the list of every workspace, and the pinned
    Create workspace row. Acceptance: the trigger has an accessible name, the
    open workspace is marked, and the whole control works from the keyboard.
16. Place the switcher at the top of the sidebar in
    `apps/web/src/shell/shell.tsx`, above the New note row, inside the existing
    drawer layout. Acceptance: the narrow drawer still fits its header, the New
    note action and the tree, and `tools/check-design-rules.mjs` passes.
17. Add the create dialog under `apps/web/src/features/` beside the New folder
    dialog. It calls the generated `createWorkspace`, then switches to the new
    workspace. Acceptance: the dialog builds no URL, supports Escape, and
    reports one sentence for one cause.
18. Add Rename and Delete permanently for the open workspace. Rename calls the
    generated `updateWorkspace`. Delete permanently confirms first, then calls
    `deleteWorkspace` and switches to another workspace of the account.
    Acceptance: Delete permanently is hidden when the account holds one
    workspace, and the wording matches the product terms of the root
    `AGENTS.md`.
19. In `apps/web/src/app.tsx`, build the engine set of record 0050 from the open
    workspace and the answer of item 8, and subscribe to the queue change the
    store already publishes. Acceptance: only the open workspace reports its
    state to the person, and a background engine stops when its queue drains.
20. Add the switch action to `apps/web/src/lib/palette-items.ts`, and keep the
    note search of the palette inside the open workspace. Acceptance: the
    palette lists no note of another workspace.
21. Keep every testable rule of items 11 to 20 in a `.ts` file beside its
    component with its own unit test. Acceptance: no rule of the switcher sits
    only in a `.tsx` file.

## E. Verification (0049, 0050, 0051)

22. Add `tests/e2e/workspaces.spec.ts`. It creates a second workspace through
    the switcher, writes a note in it, switches back, and proves the first
    workspace does not list that note. Acceptance: it drives the visible
    interface by role and accessible name, and it checks the server result.
23. Extend that file with the rename journey and the delete journey. Acceptance:
    the delete moves the person to another workspace, and Delete permanently is
    absent while one workspace remains.
24. Add the background sync journey: write in one workspace, switch away without
    waiting, and prove the server holds the note without a return to it.
    Acceptance: it waits for a condition and adds no fixed delay.
25. Extend `tests/e2e/accessible-names.spec.ts` for the switcher trigger and the
    pinned row. Acceptance: every icon-only action of the new control has a
    name and a title.
26. Update `AGENTS.md` in `apps/web`, `packages/ui`, `packages/sync`,
    `packages/storage-browser`, `packages/core` and `packages/storage-server`,
    each in the commit that moves its boundary.
27. Add the workspace page to `docs/guide/` and list it in `docs/guide/README.md`
    under "Writing notes". Acceptance: it starts with the sentence that names
    its reader and shows no identifier.
28. Update `docs/development/identity.md` and any development page that says the
    workspace is implicit. Acceptance: no page under `docs/development/` points
    at record 0005 as current, and every page stays under 150 lines.
29. Run `pnpm verify`, then the full browser matrix, because navigation,
    persistence and keyboard behaviour all change.
