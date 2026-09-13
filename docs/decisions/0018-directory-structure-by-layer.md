# 0018. The directory structure follows ports and adapters

- Status: Accepted
- Date: 2026-09-11

## Context

Inside a package nothing says where a file belongs. `local-store.ts` is 2,609
lines, `apps/server/src/http/` mixes plugins with route handlers, and
`apps/web/src/features/` is flat, so the largest files keep growing.

## Decision

The repository follows ports and adapters. New code goes where this structure
says, and a directory it does not name keeps its meaning.

- **`apps/server/src`**: `main.ts` the process entry (configuration, wiring,
  start, graceful shutdown); `app.ts` the composition root (create Fastify,
  register the plugins and the routes, wire the adapters into the use cases);
  `config/` the one reader of the environment and the secrets, validated once;
  `plugins/` one cross-cutting Fastify plugin per file and no business rule
  (security headers, request log, error handler, session, rate limit, static
  assets, host check); `routes/` one file per resource (notes, trash, history,
  search, export, attachments, account, setup, health), each of them the
  controller that validates with the contract, resolves the actor, calls one
  use case and maps the result.
- **`packages/core/src/<context>/`**: one directory per context (notes,
  history, trash, search, attachments, identity, workspaces), each with
  `model.ts` for the entities and their invariants, one use case per file as
  the service layer, `ports.ts` for the interfaces, `errors.ts` for the typed
  results, no input and output and no runtime dependency.
- **`packages/storage-server/src/postgres/`**: `transaction.ts` the unit of
  work with the workspace lock and the savepoints, one repository per context
  that implements its port and holds SQL only, `postgres/migrations/`, and
  `filesystem/attachments.ts` for the attachment bytes.
- **`apps/web/src`**: `main.tsx` the entry, `app.tsx` the provider tree only,
  `router.tsx` the lazy routes; `app/` the cross-cutting providers (session,
  workspace, store, sync, theme, notices); `shell/` the layout (header,
  sidebar, drawer, command palette); `features/<feature>/` one directory per
  feature (notes, editor, history, trash, attention, search, folders, settings,
  auth, export) with its components, hooks and pure logic files; `lib/` pure
  helpers without React.
- **`packages/storage-browser/src/local-store.ts`** splits behind the same
  port: drafts, versions, queue and receipts, recovery, preferences, snapshot.

The structure carries these rules. A route never imports a store, `core` never
imports Fastify, `pg` or a Node built-in module, and an adapter never imports a
route. Every write goes through the transaction object, and the contract is the
only API definition. A web feature reaches another feature only through `app/`
or `lib/`, takes its data from the generated client and the local store, and
keeps its pure logic in a tested `.ts` file next to the component.

## Consequences

`tools/check-boundaries.mjs` grows these rules and becomes the gate, so a
misplaced file fails `pnpm lint`. Reaching the structure is one migration epic
before 0.1.0 and one row on the
[GitHub project board](https://github.com/users/bkhanale/projects/2). Each step
updates the nested `AGENTS.md` of the directory it moves and the checker in the
same change. Until the epic closes, this record decides where new code goes.
