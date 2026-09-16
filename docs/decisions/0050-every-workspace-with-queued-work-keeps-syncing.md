# 0050. Every workspace with queued work keeps syncing

- Status: Accepted
- Date: 2026-09-16

## Context

`useWorkspaceSync` in `apps/web/src/app.tsx` builds one sync engine from the
account and the workspace in the address. A save is durable when it reaches
IndexedDB and it reaches the server when that engine sends its queue.

With one workspace the engine always serves the workspace that holds the work.
[Record 0049](0049-a-workspace-is-an-explicit-container.md) lets a person leave
a workspace. A person can then write in one workspace, switch to another, and
close the tab. The queue of the first workspace waits on the device until
somebody opens that workspace again. Nothing is lost and nothing is safe: a
device that is wiped, or a workspace that the person does not open again, never
sends those saves. A person cannot see this and cannot act on it.

Running an engine for every workspace answers the problem and charges for it
forever: each workspace polls the change feed on its own interval, including
every workspace that holds nothing to send.

See [design 010](../design/010-workspaces-as-an-explicit-container.md).

## Decision

The set of running sync engines is the open workspace together with every
workspace of the account whose local queue is not empty. A workspace with
nothing to send runs no engine. A workspace with something to send runs one
until its queue drains, then stops.

`packages/sync/src/local-port.ts` gains one read: the workspaces of one account
that hold a queue entry. `packages/storage-browser` implements it over the
account wide index that the queue table already carries, so no schema version
and no record upgrade is needed. `apps/web/src/app.tsx` turns that answer into
the engine set and subscribes to the queue change that the store already
publishes.

One tab is still one sync worker. The lease of
`packages/storage-browser/src/local-store/preferences.ts` stays one row for the
browser profile. Every engine of one tab shares the one owner identifier of
that tab, so they renew the same lease and another tab is still excluded. This
decision makes that a stated rule instead of an accident.

Only the open workspace reports its state to the person. A background engine is
quiet: it announces nothing and it changes no sentence on the screen.

## Consequences

- No local write waits for a person to navigate back to its workspace.
- The cost follows the work. A person with five workspaces and one queue runs
  at most two engines.
- A shared lease is now load bearing, so a test proves that two engines of one
  tab both hold it and that an engine of a second tab does not.
- `packages/sync/src/engine.test.ts` gains the case that a background engine
  stops when its queue empties. A browser journey writes in one workspace,
  switches, and proves the server holds the note without a return.
