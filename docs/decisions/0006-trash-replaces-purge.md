# 0006. Trash replaces the purge screen

- Status: Accepted
- Date: 2026-09-10

## Context

Delete moved a note out of the list, and a separate purge screen, a recovery
screen, and an offline status screen each showed one part of the same state.
A person who deleted a note by mistake had no obvious way back.

## Decision

Deleted notes are listed in Trash with Restore and Delete permanently. The
purge API stays and is called by Delete permanently. The purge, recovery, and
offline status screens are removed. Their useful parts move: offline
availability into Settings, and parked saves into a Needs attention list that
the save state chip links to.

## Consequences

- Delete is reversible until the person selects Delete permanently.
- Delete permanently also releases the attachment bytes that no live revision
  references.
- Three screens become one list plus two settings rows.
