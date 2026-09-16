# Files, revisions, and atomic changes

Every change to workspace content is a changeset: one atomic operation over one
or more files. A create, an edit, a rename, a delete, and a folder move all go
through `commitChangeset` in `packages/core/src/files/commit.ts`. There is
therefore one place that decides whether a change is accepted, and one
transaction order.

The product uses one linear history for the single user. A superseded document
can describe an earlier collaboration behaviour that is gone.

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

## Transaction order

`commitChangeset` performs its checks in a fixed order, and no check is skipped
because an earlier one passed. The order is in the code; two positions in it
carry reasoning that the code cannot state.

**The receipt is read before the heads and before the quota**, because a first
attempt that the client never saw may already have changed both. A replay still
passes the role and grant check first, so it never grants access that the actor
has since lost.

**The workspace lock is taken before the first check.** Every write of one
workspace is therefore serialized, and nothing can overtake a changeset between
its checks and its write. The row locks of the affected files are taken inside
the accept step, in identifier order, so two changesets that share files cannot
deadlock.

The whole write is one transaction inside a savepoint, so an expected failure
such as a path conflict writes nothing and a partly applied changeset cannot
exist. A refused changeset also consumes no commit cursor.

The HTTP adapter keeps the same order in front of the use case: it reads the
receipt for a mutation identity before it reads the current head, so an
accepted mutation stays replayable after its head has moved on or its file was
deleted, and a mutation identity that was used for another operation is a
conflict rather than a failed precondition. The use case applies the order
again inside its transaction, so a race only sends the request down the normal
path.

## Preconditions and entity tags

A strong entity tag is the accepted head revision. A revision is immutable, so
one tag names exactly one state of one file.

- A read returns the tag of the head, and a conditional read that matches
  answers not modified with no body.
- An update and a delete need the tag. A request without one is refused as a
  missing precondition, and a tag that no longer names the head is refused with
  the file identifiers in the problem. A weak tag is refused, because the
  standard requires strong comparison and a weak tag would permit a lost
  update. A wildcard tag is refused for the same reason: it would accept
  whatever the head is now, which is the lost update the precondition exists to
  prevent.
- A create carries no precondition header. The changeset states that the file
  must not exist yet, so a file that already exists fails.
- A changeset carries its observed heads in the body. A missing entry, and an
  entry for a file the changeset does not change, are both invalid. An old
  observed head is the normal path for a queued save from an offline device.

A write answer carries the accepted revision without its text. The client that
wrote it already holds the content, and an actor that may write but not read
must not receive content through a write answer. The answer is built from the
accepted write itself, never from a read that follows it.

## The rebase

A later save always wins the head, and no save removes text that the person who
made it never saw. Three rules together give that result.

**The head is reported.** When the accepted head moved between the read of the
client and the commit, the answer names the file as superseded, with the head
that the save passed and the revision that became the new head. The passed head
stays in the history, so nothing is lost. The client turns each entry into one
notice that says the save is now the latest version and the other text is in
History.

**A deletion boundary is never crossed.** A rebase is refused as a stale head
in two cases: the head is a tombstone and the changeset carries an update or a
rename, because the note is deleted and the save would bring it back with text
that predates the deletion; and the changeset carries a deletion whose
precondition the head has moved past, because that deletion would remove text
the person never read. A stale delete can therefore never remove newer text.

The client answers a refused precondition by reading the accepted state again.
A refused deletion is dropped and the person is told the note stays. A refused
update of a note that is now deleted is kept as a parked save. Anything else
moves its precondition to the accepted head and is sent once more.

**The path of the head survives.** The path of a note is content, so a rename
is a revision like any other. A rebased update takes the path of the current
head, which keeps a rename made on another device. The submitted path wins only
when this save renamed the note itself, which shows as a submitted path that
differs from the path of the head the client saw.

## Note links

A link from one note to another is a standard Markdown link. There is no wiki
syntax and no title lookup, so a rename of the target never breaks a link. See
[decision 0004](../decisions/0004-standard-links-between-notes.md).

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

## Status mapping

`apps/server/src/plugins/problem.ts` maps every domain failure in one table. Read
it rather than a copy. Two rules are not obvious from the table: a workspace
the actor cannot see answers the same as one that does not exist, and a problem
that refers to files carries their identifiers only, never a path and never
note content.

## Limits

One changeset changes a bounded number of files, and the transport schema caps
the array sizes more coarsely to protect the parser. A list page is bounded and
ordered by identifier, and the cursor is the last identifier of the page.
`packages/core/src/files/` holds the numbers.

A permanent deletion frees database rows at once and attachment bytes later.
The daily reclaim is the only code that deletes an attachment file, so a purge
never removes the bytes of an upload that is still in flight. See
[Database](database.md).

## Adding a content operation

Follow [Adding an API operation](api-contract.md). A content operation also
has to:

- build its changeset input through a builder in
  `packages/core/src/files/operations.ts` rather than by hand;
- compute the request digest from the validated request, never from a value the
  handler invented;
- build its answer from the accepted result, never from a read that follows the
  write;
- leave every permission decision to the use case. A handler has no role check.
  A read that the write path needs, such as the head a revision replaces,
  checks the write action rather than the read action.
