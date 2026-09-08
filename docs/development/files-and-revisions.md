# Files, revisions, and atomic changes

Every change to workspace content is a changeset: one atomic operation over
one or more files. A create, an edit, a rename, a named checkpoint, a delete,
and a folder move all go through the same use case,
`commitChangeset` in `packages/core/src/files/commit.ts`. There is therefore
one place that decides whether a change is accepted, and one transaction order.

The current product uses one linear history for the single user. Old design
documents can describe earlier collaboration behavior that is no longer
available.

## The model

| Record    | What it holds                                                                             |
| --------- | ----------------------------------------------------------------------------------------- |
| File      | A UUID that never changes, the accepted path, the kind, the head, and the deletion state. |
| Revision  | An immutable UUID, its parents, its path, its content, its actor, and its times.          |
| Content   | Immutable Markdown or an attachment reference, addressed by its SHA-256 digest.           |
| Changeset | One atomic operation, its mutation identity, its device, and its request digest.          |
| Receipt   | The stored outcome of one accepted mutation of one actor.                                 |

A file identity is independent of its path, so a rename never breaks a link. A
revision is immutable: its identifier names one state of one file for as long
as the workspace exists. A deletion is a tombstone revision, so the history of
a deleted file stays complete and a later restore is possible.

The client assigns the file, revision, and mutation identifiers. A note written
offline therefore keeps one identity on every device, and a retry that lost its
answer repeats the same operation instead of writing a second one.

## Digests

`packages/core/src/files/digest.ts` holds both digests. Both are SHA-256. It
uses WebCrypto when `crypto.subtle` is available. Plain HTTP browser contexts
can omit that API, so the same module has a tested TypeScript SHA-256 fallback
with known-answer tests. Both paths produce the same lower case hexadecimal
value.

Client identifiers use the shared `generateUUID` function. It prefers
`crypto.randomUUID`, uses `crypto.getRandomValues` with RFC 4122 version 4 bit
masks when needed, and has a final compatibility fallback for environments
without Web Cryptography. Application code does not call
`window.crypto.randomUUID` directly.

A **content digest** is the SHA-256 of the UTF-8 bytes of the Markdown, in
lower case hexadecimal. No Unicode normalization is applied: two spellings of
one word are two documents, and a client that stored one of them gets it back
unchanged. Content is deduplicated per workspace by this value, so a revision
that declared the digest of other stored bytes would resolve to those bytes.
`commitChangeset` recomputes every Markdown digest before storage, and storage
checks it again; both answer `invalid_content`.

A **request digest** is the SHA-256 of
`operationId + "\n" + canonical(preconditions) + "\n" + canonical(body)`.
Canonical JSON is the value with:

- object keys sorted in ascending UTF-16 code unit order, at every depth;
- array order kept;
- an explicit `null` kept, and a member whose value is `undefined` left out;
- `undefined` inside an array written as `null`;
- a non-finite number, a `bigint`, a function, and a symbol rejected with
  `CanonicalJsonError`. The contract schema rejects the same values, so a
  request never reaches this error through the HTTP boundary.

The HTTP adapter computes it from the validated request: the operation id, the
path identifiers and the entity tags that `If-Match` stated, and the body. The
digest covers the tags as they were sent, not the head they resolved to, so a
retry of one request reaches the same value however the workspace has moved on
since. Two retries of one operation therefore agree, and a reused mutation
identity with another body does not.

## Transaction order

`commitChangeset` performs these steps, and no check is skipped when an earlier
one passed:

```text
refuse an empty changeset and one over 1000 files      (before any query)
take the workspace lock                                (store.transact)
check the current role and the verified grants for `write`
read the actor bound receipt
  same digest    -> return the stored outcome
  other digest   -> mutation_reused
check the purge marker of every file                   (one query)
normalize and check every path
rebase each stale queued save onto the current accepted head
check the revision graph against the stored parents
check every Markdown text and its digest
accept
  lock the affected file rows in identifier order
  write content, revisions, heads, live paths, cursor, sync record, receipt
remove the side records of every deleted file
commit once
```

The receipt is read before the heads and before the quota, because a first
attempt that the client never saw may already have changed both. A replay still
passes the role and grant check first, so it never grants access that the actor
has since lost. The whole write is one PostgreSQL transaction inside a
savepoint, so an expected failure such as a path conflict writes nothing and a
partly applied changeset cannot exist. A refused changeset also consumes no
commit cursor.

The workspace lock is an advisory transaction lock, and it is taken before the
first check. Every write of one workspace is therefore serialized, and nothing
can overtake a changeset between its checks and its write. The row locks of the
affected files are taken inside `accept`, in identifier order, so two
changesets that share files cannot deadlock. The path uniqueness constraint is
deferred, which is what permits an atomic swap of two paths inside one
changeset.

The HTTP adapter keeps the same order in front of the use case. A single file
write reads the actor's receipt for its mutation identity before it reads the
current head, so an accepted mutation stays replayable after its head has moved
on or its file was deleted, and a mutation identity that was used for another
operation answers 409 rather than 412. The use case applies the order again
inside its transaction, so a race only sends the request down the normal path,
where the receipt is found again.

`onFilesDeleted` runs after `accept`, inside the same transaction. It removes
the file's link index rows and other derived records.

## Preconditions and entity tags

A strong entity tag is the accepted head revision in quotes, for example
`"3f1c2b7a-0e5d-4c1b-9a7e-2b6d4f8c1a03"`. A revision is immutable, so one tag
names exactly one state of one file.

- `getFile` returns the tag of the head. `If-None-Match` with that tag answers
  `304` with no body, and the answer repeats the tag. A list of tags matches
  when any of them names the head, and `*` matches any representation, so it
  answers `304` for a file that exists.
- `updateFile` and `deleteFile` need `If-Match`. A request without it answers
  `428`, and a tag that no longer names the head answers `412` with the file
  identifiers in the problem. A list of tags is accepted and matches when any
  of them names the head. A weak tag is refused, because RFC 9110 requires
  strong comparison and a weak tag would permit a lost update. `If-Match: *`
  is refused with `428` for the same reason: it would accept whatever the head
  is now, which is the lost update that the precondition exists to prevent.
- A write answer carries the accepted revision without its text. The client
  that wrote it already holds the content, and an actor that may write but not
  read must not receive content through a write answer. The answer is built
  from the accepted write itself, never from a read that follows it.
- `createFile` carries no precondition header. The changeset states that the
  file must not exist yet, so a file that already exists answers `412`.
- `commitChangeset` carries its observed heads in the body. A missing entry and
  an entry for a file that the changeset does not change are both
  `422 invalid_graph`. If the observed head is old, the server makes the first
  submitted revision a child of the current head. This is the normal path for
  a queued Save from an offline device.

The tag in a direct write answer names the revision that the operation
accepted. Direct conditional endpoints can still answer `412`. The browser
sync queue uses `commitChangeset`, which rebases a stale Save.

## Status mapping

`apps/server/src/http/problem.ts` maps every domain failure in one table.

| Domain code       | Status | Problem code      |
| ----------------- | ------ | ----------------- |
| `forbidden`       | 403    | `forbidden`       |
| `not_found`       | 404    | `not_found`       |
| `path_conflict`   | 409    | `path_conflict`   |
| `mutation_reused` | 409    | `mutation_reused` |
| `purged`          | 410    | `purged`          |
| `stale_head`      | 412    | `stale_head`      |
| `quota`           | 413    | `quota_exceeded`  |
| `invalid_path`    | 422    | `invalid_path`    |
| `invalid_graph`   | 422    | `invalid_graph`   |
| `invalid_content` | 422    | `invalid_content` |

A missing precondition is `428 precondition_required`, and a workspace that the
actor cannot see is `404 not_found`, which is also the answer for a workspace
that does not exist. A problem that refers to files carries their identifiers in
`fileIds`; it never carries a path or note content.

## Limits

- One changeset changes at most 1000 files. The transport schema caps
  `revisions` and `expectedHeads` at 4000 entries, which is a coarse bound that
  protects the parser; the file limit is the domain rule and answers `422`.
- A list page returns at most 500 files and 100 by default. The cursor is the
  last file identifier of the page, and the order is by identifier.
- The workspace quota counts content, revision metadata, and receipts. A
  changeset that adds content must fit below the quota minus a 1 MiB control
  reserve. Only a changeset that both deletes every file it touches and adds no
  content byte may use that reserve, so a full workspace can still be tidied
  and a deletion that carried content cannot reach the reserved capacity
  through a disguised write. Storage applies that rule, and the use case
  refuses a note tombstone that carries Markdown with `invalid_content` before
  it gets there. A tombstone therefore adds no content: the revision before it
  still holds the text, and an attachment tombstone keeps the object reference
  of its parent.

## Adding an operation

Follow `docs/development/api-contract.md`. A content operation also has to:

- build a `ChangesetInput` through a builder in
  `packages/core/src/files/operations.ts` rather than by hand;
- compute the request digest from the validated request, never from a value
  that the handler invented;
- build its answer from the accepted result, never from a read that follows the
  write;
- leave every permission decision to the use case. A handler has no role check.
  A read that the write path needs, such as the head that a revision replaces
  or the receipt of a retry, checks `write` rather than `read`.
