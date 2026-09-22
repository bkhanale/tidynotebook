# 0086. Protocol upgrades precede the breaking sync format

- Status: Accepted
- Date: 2026-09-22

## Context

`packages/sync/src/queue.ts` does not load a new client for an unknown format
error. Cached clients cannot acquire that behavior from a server change.
The original plan also removes store APIs before their screen callers change.
See [design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- A compatibility release precedes the breaking format. Its generated contract
  operation checks protocol capability before push and pull. An absent operation
  identifies a legacy server; it does not imply support for the new protocol.
- The compatibility client persists working text before it activates a waiting
  service worker and reloads. It coordinates open tabs. Failed persistence,
  installation, or database upgrade keeps the working text and a recovery action.
- The new server detects legacy requests before new-schema validation. Clients
  older than the compatibility release receive their readable response shapes
  or a tested stop response their existing engine handles without dropping work.
  An unknown new error code is never the only upgrade path.
- An authorized receipt lookup resolves the original mutation and request digest
  across the format boundary. Transformation follows a confirmed outcome, never
  a timeout. Drain incompatible writers before absence becomes definitive. A
  write-only caller receives no content through that lookup.
- [Issue 162](https://github.com/bkhanale/notesapp/issues/162) owns these records,
  the compatibility implementation, its release, and deployment evidence. The
  document package can then land unused. The contract, server, browser store,
  editor binding, and note screen land together on one feature branch.
- Each changed boundary updates its directory guide in the same commit. The
  current development guides describe shipped code, not the target before it
  exists. The parent issue owns final guide review and design completion.
- Before cutover, test a pre-compatibility client, the compatibility client,
  and the new protocol. Include long-offline work, old reads and writes, a lost
  reply, a waiting worker, multiple tabs, and a blocked local upgrade.
- Back up before server migration. Stop incompatible writers during rollback.
  Never run the old writer beside live CRDT rows. Preserve post-migration work
  before a database restore, or keep writes stopped until a forward repair.

## Consequences

- A separate release and recovery rehearsal cost more than one deployment.
- Served integration tests prove format and capability behavior. Manual browser
  checks prove worker activation and reload under record 0066. `pnpm verify`
  passes before each landing, and the release follows `releasing-a-version`.
- Documentation completion does not complete the compatibility release or the
  feature. Plan 013 and design 013 stay active until the parent acceptance passes.
