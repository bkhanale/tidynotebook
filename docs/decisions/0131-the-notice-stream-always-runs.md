# 0131. The notice stream always runs

- Status: Accepted
- Date: 2026-09-29

## Context

Records 0125 and 0129 put the notice stream behind two switches: the shared
publishing switch `sync_publishing` of the database, and the admission
setting `NOTESAPP_SYNC_NOTICES` of each process. Both were off by default, so
plan 016 could turn the stream on for a cohort after a measured rollout. The
owner decided on 2026-09-29 that every deployment runs the stream, and that
performance is measured apart from this plan.

## Decision

- Every server process admits notice streams while its listener listens, and
  every notice trigger sends its hint. Migration 0020 drops `sync_publishing`
  and its two functions, and the triggers read no switch.
- `NOTESAPP_SYNC_NOTICES` and `pnpm notices:publishing` are removed.
- Saves, receipts, feed pages, snapshots and attachments stay on HTTP, as
  record 0124 states.
- The poll stays as the fallback of a device whose stream is down, refused,
  or not offered, and a healthy stream keeps its long safety read.

This replaces the switch bullets of records 0125 and 0129. Every other part of
those records stands.

## Consequences

- A deployment gets live updates with no step of its own. A proxy that blocks
  the upgrade leaves its browsers on the poll, as an old server does.
- An emergency stop of every notice is a deploy of an earlier release, not a
  command. A notice queue failure still fails a commit, and the device sends
  the queued save again.
- The tests of the switches go, and `tests/integration/sync-notices.test.ts`
  proves that a hint goes out with no switch.
