# Accepting a changeset

`commitChangeset` in `packages/core/src/files/commit.ts` is the one place that
decides whether a change to workspace content is accepted. This page states
the order of its steps, the precondition that a client carries, what happens
to a save whose parent moved on, and how each refusal reaches the caller.
[Files, revisions, and atomic changes](files-and-revisions.md) states the model
that those steps act on.

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

## Status mapping

`apps/server/src/plugins/problem.ts` maps every domain failure in one table. Read
it rather than a copy. Two rules are not obvious from the table: a workspace
the actor cannot see answers the same as one that does not exist, and a problem
that refers to files carries their identifiers only, never a path and never
note content.

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
