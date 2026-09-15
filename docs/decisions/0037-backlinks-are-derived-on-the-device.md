# 0037. Backlinks are derived on the device and merged with the server index

- Status: Accepted
- Date: 2026-09-16

## Context

The path based link index landed with item 3 of
[plan 009](../plans/009-portable-markdown-at-rest.md): the table `note_links`,
`packages/storage-server/src/workspace-store/portable-links.ts`,
`packages/core/src/files/backlinks.ts`, and the panel
`apps/web/src/features/editor/backlinks.tsx`.

The panel reads the server only, so with no connection a note with inbound
links states that it has none. The device already holds every accepted note
body: `stageSnapshot` in `packages/sync/src/snapshot.ts` pages every file of
the workspace, and `listSearchFiles` in
`packages/storage-browser/src/local-store/files.ts` reads every body with the
current draft on top. See
[design 009](../design/009-backlinks-on-standard-links.md).

## Decision

`note_links` stays the one index at rest and the one authority. The device
derives its own answer and the panel merges the two.

- A pure function in `packages/sync/src/local-backlinks.ts` takes the rows of
  `listSearchFiles` and the path of the open note, and returns the notes that
  link to it. It sits beside `local-search.ts` and follows its shape: no input,
  no output, no storage, and a unit test file next to it.
- The device stores no link index. No object store joins the thirteen of
  `packages/storage-browser/src/database.ts`, so there is no schema version and
  no second write path that can drift.
- The derivation filters before it parses. A body reaches `extractLinks` of
  `packages/markdown` only when it holds the last segment of the target path,
  in the composed form, in the decomposed form, or in the canonical percent
  encoded form that `portableRelativePath` of `packages/markdown/src/rewrite.ts`
  writes, or when it holds a percent sign at all. A body outside that set
  cannot hold a link to the target. The unit test holds all four cases.
- The panel merges the two answers the way `apps/web/src/shell/command-palette.tsx`
  merges search results, and marks the answer when the server did not reply.
- The rewrite on a move stays on the server. `expandMovedReferences` is the
  only place that sees every source of every device in one transaction.

This excludes a link index in IndexedDB, a second extractor of links, a stored
derivation cache, a worker before a browser journey proves one is needed, and
any change to the shape or the ownership of `note_links`.

## Consequences

- The panel answers with no connection, it shows a link in an unsaved draft
  that the server index cannot hold, and it knows the true count that the 100
  row cap of `listBacklinks` cannot give.
- A rename made with no connection is repaired by the server when the changeset
  is accepted, so the derived answer misses that link until the queue drains.
- The cost of a read grows with the workspace, unlike the server seek on
  `note_links_target_idx`. The filter holds it near the cost the palette pays.
- A browser journey with the network down proves that a note with an inbound
  link lists it, and the unit tests of `packages/sync` prove the four spellings
  of the filter. `pnpm verify` and the browser matrix hold both.
