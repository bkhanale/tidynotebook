# 0023. One auto-expiring Trash

- Status: Accepted
- Date: 2026-09-12

## Context

Delete had three interactions and two vocabularies. The sidebar deleted with no
confirmation, the editor asked first, and Trash offered Delete permanently. Undo
and Restore were one operation under two words. Record 0006 introduced Trash with
Restore and Delete permanently. The audit found that the manual permanent delete
races the deletion queue and produces the resurrection class. See
[design 005](../design/005-streamline-save-and-delete.md).

## Decision

Delete moves a note to one Trash, with one interaction everywhere. The Trash
empties itself after a fixed retention window of 30 days. A server job purges an
expired note, so the person never selects Delete permanently, and that action is
removed. Restore is the one word for the way back; the undo notice uses Restore
too. The purge stays as the mechanism that the expiry job calls. This record
supersedes record 0006.

## Consequences

- The person meets one delete interaction, one Trash, and one recovery word.
- No person action races the deletion queue, so the manual purge path that
  produced the resurrection cannot happen.
- The expiry needs a scheduled server job and a retention field. The purge use
  case in `packages/core/src/history/purge.ts` stays, called by the job.
- The gate is a browser test that deletes, restores, and confirms an expired
  note is gone, and a server test of the expiry job.
