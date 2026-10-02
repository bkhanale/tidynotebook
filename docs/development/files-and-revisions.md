# Files, revisions, and atomic changes

Every change to workspace content is a changeset: one atomic operation over one
or more files. A create, an edit, a rename, a delete, and a folder move all go
through `commitChangeset` in `packages/core/src/files/commit.ts`. There is
therefore one place that decides whether a change is accepted, and one
transaction order.

The product uses one linear history for the single user. A superseded document
can describe an earlier collaboration behaviour that is gone.

This page states what a file, a revision and a digest are.
[Accepting a changeset](accepting-a-changeset.md) states what the server does
when one arrives.

## The model

A **file** has an identity that never changes, plus the accepted path, the
kind, the head, and the deletion state. A **revision** is immutable: its
identifier names one state of one file for as long as the workspace exists.
**Content** is immutable and addressed by its digest. A **changeset** is one
atomic operation with its mutation identity. A **receipt** is the stored
outcome of one accepted mutation of one actor.

Two properties follow, and the rest of this page exists to keep them.

- A file identity is independent of its path, so a rename never breaks a link.
- A deletion is a tombstone revision, so the history of a deleted file stays
  complete and a later restore is possible.

The client assigns the file, revision, and mutation identifiers. A note written
offline therefore keeps one identity on every device, and a retry that lost its
answer repeats the same operation instead of writing a second one.

## Digests

`packages/core/src/files/digest.ts` holds both digests. It uses WebCrypto where
the browser exposes it and a tested fallback where a plain HTTP context does
not, and both paths produce the same value. Client identifiers go through the
shared generator in the same package for the same reason; application code does
not reach for the platform function directly.

A **content digest** covers the bytes of the Markdown. No Unicode
normalization is applied: two spellings of one word are two documents, and a
client that stored one of them gets it back unchanged. Content is deduplicated
per workspace by this value, so a revision that declared the digest of other
stored bytes would resolve to those bytes. The commit recomputes every digest
before storage and storage checks it again.

A **request digest** covers the operation id, the preconditions, and the body,
each in a canonical form with sorted object keys and kept array order. The HTTP
adapter computes it from the validated request and covers the entity tags as
they were sent, not the head they resolved to, so a retry of one request
reaches the same value however the workspace has moved on. Two retries of one
operation therefore agree, and a reused mutation identity with another body
does not.

## Note links

A link from one note to another is a standard Markdown link. There is no wiki
syntax and no title lookup, so a rename of the target never breaks a link. See
[decision 0004](../decisions/0004-standard-links-between-notes.md). A wiki
link becomes a standard link at the border, from the link list, typed
brackets, a paste or an import, through `convertWikiLinks` of
`packages/markdown/src/wiki-links.ts`
([decision 0172](../decisions/0172-a-wiki-link-becomes-a-standard-link-at-the-border.md)).

The accepted body of a note is indexed by the paths that it links to.
`packages/storage-server/src/workspace-store/portable-links.ts` writes the
`note_links` rows inside the transaction that accepted the changeset, and it
also adds the revisions that keep a link live after a move. A draft is
therefore never in the index. `packages/core/src/files/backlinks.ts` reads the
index behind the read permission of the workspace,
`apps/server/src/routes/backlinks.ts` serves the one operation over it, and
`apps/web/src/features/editor/backlinks.tsx` is the panel that a person reads.
The panel merges that answer with one that `packages/sync/src/local-backlinks.ts`
derives from the bodies of this device, so it answers with no connection, it
sees the open draft, and it marks a list that the server did not confirm. See
[decision 0037](../decisions/0037-backlinks-are-derived-on-the-device.md) and
[decision 0038](../decisions/0038-an-empty-state-is-not-a-failed-read.md).

## Limits

One changeset changes a bounded number of files, and the transport schema caps
the array sizes more coarsely to protect the parser. A list page is bounded and
ordered by identifier, and the cursor is the last identifier of the page.
`packages/core/src/files/` holds the numbers.

A permanent deletion frees database rows at once and attachment bytes later.
The daily reclaim is the only code that deletes an attachment file, so a purge
never removes the bytes of an upload that is still in flight. See
[Database](database.md).
