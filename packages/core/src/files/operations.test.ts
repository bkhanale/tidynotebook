/**
 * The changeset builders of the single file and folder operations.
 *
 * A builder decides the shape of a submission only. Every rule that decides
 * whether the submission is accepted lives in `commitChangeset`, so these
 * checks look at the produced changeset and nothing else.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { maxFilesPerChangeset } from './commit.ts';
import { contentDigest } from './digest.ts';
import type { ContentRef } from './model.ts';
import {
  createFileChangeset,
  markdownContent,
  renameFolderChangeset,
  tombstoneContent,
  updateFileChangeset,
  type FolderMember,
  type SubmissionIds,
} from './operations.ts';

const workspaceId = 'w1';
const ids: SubmissionIds = {
  mutationId: 'm1',
  deviceId: 'device-1',
  clientTime: '2026-09-06T10:00:00.000Z',
};

await test('markdown content carries the digest of its own bytes', async () => {
  const content = await markdownContent('# one\n');
  assert.equal(content.kind, 'markdown');
  assert.equal(content.digest, await contentDigest('# one\n'));
});

await test('a tombstone carries no note text but keeps an attachment', async () => {
  const note = await tombstoneContent(await markdownContent('# long\n'));
  assert.equal(note.kind, 'markdown');
  assert.equal(note.kind === 'markdown' ? note.text : 'x', '');
  assert.equal(note.digest, await contentDigest(''));

  const attachment: ContentRef = {
    kind: 'attachment',
    digest: 'a'.repeat(64),
    objectId: 'o1',
  };
  // An attachment revision has no other way to name content, so the tombstone
  // keeps the object of its parent.
  assert.deepEqual(await tombstoneContent(attachment), attachment);
});

await test('a new file states that it must not exist yet', async () => {
  const changeset = createFileChangeset({
    workspaceId,
    fileId: 'f1',
    revisionId: 'r1',
    path: 'notes/one.md',
    content: await markdownContent('# one\n'),
    message: 'first',
    ids,
  });
  assert.deepEqual(changeset.expectedHeads, { f1: null });
  assert.equal(changeset.revisions.length, 1);
  assert.deepEqual(changeset.revisions[0]?.parents, []);
  assert.equal(changeset.revisions[0]?.message, 'first');
  assert.equal(changeset.revisions[0]?.deleted, false);
  assert.equal(changeset.mutationId, 'm1');
});

await test('a change of an existing file names the expected head as its parent', async () => {
  const changeset = updateFileChangeset({
    workspaceId,
    fileId: 'f1',
    revisionId: 'r2',
    expectedHead: 'r1',
    path: 'notes/two.md',
    content: await markdownContent('# two\n'),
    deleted: true,
    message: null,
    ids,
  });
  assert.deepEqual(changeset.expectedHeads, { f1: 'r1' });
  assert.deepEqual(changeset.revisions[0]?.parents, ['r1']);
  assert.equal(changeset.revisions[0]?.deleted, true);
});

/** One member of a folder, with test defaults. */
async function member(index: number): Promise<FolderMember> {
  return {
    fileId: `f${String(index)}`,
    expectedHead: `h${String(index)}`,
    revisionId: `r${String(index)}`,
    path: `notes/${String(index)}.md`,
    content: await markdownContent(`# ${String(index)}\n`),
  };
}

await test('a folder rename rewrites the prefix of every member', async () => {
  const files = await Promise.all([member(1), member(2)]);
  const built = renameFolderChangeset({
    workspaceId,
    from: 'notes',
    to: 'archive/old',
    files,
    message: null,
    ids,
  });
  assert.ok(built.ok);
  const changeset = built.value;
  assert.deepEqual(
    changeset.revisions.map((revision) => revision.path),
    ['archive/old/1.md', 'archive/old/2.md'],
  );
  // Every member states its own precondition, so the whole folder moves or
  // none of it does.
  assert.deepEqual(changeset.expectedHeads, { f1: 'h1', f2: 'h2' });
  assert.deepEqual(changeset.revisions[0]?.parents, ['h1']);
  // A rename keeps the content of the head.
  assert.deepEqual(changeset.revisions[0]?.content, files[0]?.content);
});

await test('a folder rename refuses a file outside the folder', async () => {
  const outside = await member(1);
  const built = renameFolderChangeset({
    workspaceId,
    from: 'other',
    to: 'archive',
    files: [outside],
    message: null,
    ids,
  });
  assert.equal(built.ok, false);
  if (!built.ok) {
    assert.equal(built.error.code, 'invalid_path');
    assert.deepEqual(built.error.fileIds, ['f1']);
  }
});

await test('a folder rename refuses an empty set and one over the limit', async () => {
  const empty = renameFolderChangeset({
    workspaceId,
    from: 'notes',
    to: 'archive',
    files: [],
    message: null,
    ids,
  });
  assert.equal(empty.ok, false);

  const many = await Promise.all(
    Array.from({ length: maxFilesPerChangeset + 1 }, (_, index) =>
      member(index),
    ),
  );
  const over = renameFolderChangeset({
    workspaceId,
    from: 'notes',
    to: 'archive',
    files: many,
    message: null,
    ids,
  });
  assert.equal(over.ok, false);
  // The revisions are a valid change of the stored history; the only problem
  // is how many of them there are, so the refusal states that and not the
  // shape of the graph.
  if (!over.ok) assert.equal(over.error.code, 'too_many_files');
});

await test('a folder rename accepts a name in decomposed form', async () => {
  // The defect this covers: the builder compared the stored path with the
  // given folder as raw text and normalized neither side. A stored path is in
  // composed form, so a folder name that a client sent in decomposed form
  // matched no stored path and the whole rename was refused.
  const composed = 'notes/Ide\u0301es';
  const decomposed = 'notes/Ide\u0301es'.normalize('NFD');
  assert.notEqual(composed.normalize('NFC'), decomposed);
  const stored = {
    fileId: 'f1',
    expectedHead: 'h1',
    revisionId: 'r1',
    path: `${composed.normalize('NFC')}/1.md`,
    content: await markdownContent('# 1\n'),
  };
  const built = renameFolderChangeset({
    workspaceId,
    from: decomposed,
    to: 'archive/old',
    files: [stored],
    message: null,
    ids,
  });
  assert.ok(built.ok);
  assert.deepEqual(
    built.value.revisions.map((revision) => revision.path),
    ['archive/old/1.md'],
  );
});

await test('a folder rename leaves a folder whose name only starts the same', async () => {
  // `notes/trip` and `notes/trips-2026` share eleven characters, so a plain
  // prefix test would move a folder that nobody named.
  const neighbour = {
    fileId: 'f9',
    expectedHead: 'h9',
    revisionId: 'r9',
    path: 'notes/trips-2026/day.md',
    content: await markdownContent('# Day\n'),
  };
  const built = renameFolderChangeset({
    workspaceId,
    from: 'notes/trip',
    to: 'notes/journey',
    files: [neighbour],
    message: null,
    ids,
  });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.error.code, 'invalid_path');
});

await test('a folder rename writes every new path in composed form', async () => {
  const stored = {
    fileId: 'f1',
    expectedHead: 'h1',
    revisionId: 'r1',
    path: 'notes/1.md',
    content: await markdownContent('# 1\n'),
  };
  const built = renameFolderChangeset({
    workspaceId,
    from: 'notes',
    to: 'archive/Ide\u0301es'.normalize('NFD'),
    files: [stored],
    message: null,
    ids,
  });
  assert.ok(built.ok);
  const written = built.value.revisions[0]?.path ?? '';
  assert.equal(written, written.normalize('NFC'));
});
