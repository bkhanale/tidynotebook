# 0024. Remove the conflict and recovery surfaces

- Status: Accepted
- Date: 2026-09-12

## Context

Needs attention was a second inbox for saves that a server refused, with the
verbs Retry, Save as new note, Copy text, and Discard. The stale-draft bar asked
a person to keep their text or take the latest version. Both surfaces exist only
because a save can be refused or can meet another device. Automatic versions
(record 0022) keep every superseded edit as a version, so no edit is lost. See
[design 005](../design/005-streamline-save-and-delete.md).

## Decision

Last-writer-wins is the save resolution, and the loser is kept as a version. The
client no longer asks a person to resolve a save. The stale-draft conflict bar,
the Needs attention screen, the parked-saves module
(`apps/web/src/lib/parked-saves.ts`), the `attention` feature, and the recovery
table are removed. A refused save is retried on the current head or, when it can
never apply, dropped, because its text is already in History. The concurrent
deletion that record F2 of the audit names is resolved here: the delete and the
edit both become versions and the tip decides the live state, so no note is
un-deleted behind the person's back.

## Consequences

- The person meets no second inbox and no conflict prompt.
- A class of refusal edge cases and one IndexedDB table leave the code.
- The `recovery` table needs a schema version that drops it, with its record
  upgrade in `packages/storage-browser/src/migrations.ts`.
- The gate is a browser test that edits one note on two devices and proves both
  texts are in History with the later one live, and no attention surface.
