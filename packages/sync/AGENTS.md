# packages/sync

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The rules of offline work: the local persistence port, the save queue, the
lease that keeps one tab sending, the snapshot download, the checkpoint rule,
and local search.

## What lives here and what does not

- `src/local-port.ts` declares `LocalStore` and every local record shape. It
  is the contract that `packages/storage-browser` implements.
- `src/engine.ts` sends queue entries in local order with a frozen body and
  digest, so a retry repeats the same mutation.
- `src/queue.ts`, `src/lease.ts`, `src/snapshot.ts`, `src/checkpoints.ts`,
  and `src/local-search.ts` hold their own rules.
- No IndexedDB and no Dexie code lives here. No React and no screen lives
  here.

## Allowed imports

`@notesapp/core` and `@notesapp/api-client`.

This package is browser code. It cannot import a Node built in module, a Node
only package, or a server only package.

## How to add a common thing here

- **A local record.** Add the type and the port method in
  `src/local-port.ts`, then implement it in `packages/storage-browser`.
- **A queue rule.** Add it in `src/queue.ts` or `src/engine.ts` as a pure
  function over the queue state, and cover it in `engine.test.ts`.
- **A server call.** Call the generated operation from
  `@notesapp/api-client`. Never build a URL.

## Testing conventions here

`node --test` through `pnpm test:unit`, with a fake `LocalStore` built in the
test file. A test must prove the ordering and the retry behaviour without a
fixed delay: drive the clock and the port yourself. Lifecycle behaviour
against a real database is covered by
`tests/integration/offline-lifecycle.test.ts`.

## Forbidden here

- No `fetch`, no URL building, and no HTTP library. Only generated
  operations.
- No IndexedDB, no Dexie, and no direct browser storage.
- No React and no DOM rendering.
- No fixed delay in a test and no weakened assertion.
- No change of a queued body after it is frozen. A retry sends the same body
  and the same digest.
- No treatment of a draft as a server version.

## Key files

| File                 | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `src/index.ts`       | The one public entry point               |
| `src/local-port.ts`  | `LocalStore` and the local record shapes |
| `src/engine.ts`      | The send loop, ordering, and retries     |
| `src/lease.ts`       | The single sender lease                  |
| `src/checkpoints.ts` | When a save becomes a checkpoint         |
