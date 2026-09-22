# 0087. Review keeps the checkpoint that caused it

- Status: Accepted
- Date: 2026-09-22

## Context

The latest local text can change between a merged save and an opened Review.
Record 0079 does not bind the comparison to that save. Legacy recovery also
needs to make preserved work reachable. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- A normal text merge never waits for a person. Work reaches the open note
  through its existing editor view. History marks the accepted merged revision
  on every device, using the complete-state rule of record 0081.
- The device whose save merged retains the exact local checkpoint of that save.
  Review compares that text with current text through
  `packages/editor/src/unified-diff.ts`. A later draft cannot replace the base.
- A migration or repair event also offers Review. Ambiguous text recovery can
  create the synced note of record 0084; one action makes that work reachable.
  This is an exceptional recovery path, not a copy for every normal CRDT merge.
- Review state persists on that device and names its event. Opening or
  dismissing it clears that event only. A later merge can show Review again.
- Pending local History keeps frozen local text. Accepted History reads the
  server revision, which can contain remote edits as well as the local save.
- The rule lives in a pure module in `apps/web/src/lib/`. Screen copy uses one
  message per cause, a useful action, and no document or engine identifier.

This supersedes [0079](0079-review-is-the-one-surface-of-a-merge.md). It keeps
the absence of a held save or a normal choice between conflicting versions.

## Consequences

- Unit tests prove checkpoint selection, persistence, dismissal, and a later
  event. Served integration and manual browser checks prove the visible flow.
- The note, Review, recovery, and History screens get light and dark screenshots
  before landing. Screenshots do not prove sync, selection, or composition.
