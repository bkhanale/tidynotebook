# Files, revisions, and atomic changes

Every change to workspace content is a changeset: one atomic operation over
one or more files. A create, an edit, a rename, a named checkpoint, a delete,
and a folder move all go through the same use case,
`commitChangeset` in `packages/core/src/files/commit.ts`. There is therefore
one place that decides whether a change is accepted, and one transaction order.

Read `docs/design/001-initial-design.md`, sections "File model and version
control", "Revision exchange", and "Conflicts and restore", for the rules that
this document implements.

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

`packages/core/src/files/digest.ts` holds both digests. Both are SHA-256
through the WebCrypto `crypto.subtle` global, so the browser runs the same code
as the server.

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
path identifiers and the `If-Match` precondition, and the body. Two retries of
one operation reach the same value, and a reused mutation identity with another
body does not.

## Transaction order

`commitChangeset` performs these steps, and no check is skipped when an earlier
one passed:

```text
refuse an empty changeset and one over 1000 files      (before any query)
lock the workspace, then the affected files in identifier order
check the current role and the verified grants for `write`
read the actor bound receipt
  same digest    -> return the stored outcome
  other digest   -> mutation_reused
check the purge marker of every file
normalize and check every path
check the revision graph against the stored parents
compare every expected head
verify every Markdown digest
accept: content, revisions, heads, live paths, cursor, sync record, receipt
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

The workspace lock is an advisory transaction lock; the files are then locked by
identifier order, so two changesets that share files cannot deadlock. The path
uniqueness constraint is deferred, which is what permits an atomic swap of two
paths inside one changeset.

`onFilesDeleted` runs after `accept`, inside the same transaction. It revokes
every share of a deleted file and removes its link index rows. It is one port
method rather than one per index, because every caller needs all of them; the
search task extends the same implementation and no call site changes.

## Preconditions and entity tags

A strong entity tag is the accepted head revision in quotes, for example
`"3f1c2b7a-0e5d-4c1b-9a7e-2b6d4f8c1a03"`. A revision is immutable, so one tag
names exactly one state of one file.

- `getFile` returns the tag of the head. `If-None-Match` with that tag answers
  `304` with no body, and the answer repeats the tag.
- `updateFile` and `deleteFile` need `If-Match`. A request without it answers
  `428`, and a tag that no longer names the head answers `412` with the file
  identifiers in the problem. A weak tag is refused, because RFC 9110 requires
  strong comparison and a weak tag would permit a lost update.
- `createFile` carries no precondition header. The changeset states that the
  file must not exist yet, so a file that already exists answers `412`.
- `commitChangeset` carries its preconditions in the body: `expectedHeads` maps
  every changed file to the head that the client saw, or to `null` for a file
  that must not exist yet. A missing entry and an entry for a file that the
  changeset does not change are both `422 invalid_graph`, because such a file
  is not locked by the transaction and the answer would mean nothing.

The tag in a write answer names the revision that the operation accepted. A
change from elsewhere makes it stale, and the next conditional write then
answers `412`, which is how a client notices.

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
  reserve. A changeset whose revisions are all tombstones may use that reserve,
  so a full workspace can still be tidied. A tombstone carries no note text, so
  a deletion adds no content.

## Adding an operation

Follow `docs/development/api-contract.md`. A content operation also has to:

- build a `ChangesetInput` through a builder in
  `packages/core/src/files/operations.ts` rather than by hand;
- compute the request digest from the validated request, never from a value
  that the handler invented;
- leave every permission decision to the use case. A handler has no role check.
