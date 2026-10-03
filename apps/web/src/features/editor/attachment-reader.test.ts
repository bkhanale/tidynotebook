import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAttachmentRefs } from '@notesapp/markdown';
import type { LocalFileSummary } from '@notesapp/sync';
import { createAttachmentReader, type OwnedUrl } from './attachment-reader.ts';

const notePath = 'one.md';
const text = '![a picture](attachments/picture.png)\n';
const targetPath = extractAttachmentRefs(text, notePath)[0]?.targetPath ?? '';

/** The attachment file of the picture, as the feed brings it. */
const pictureFile: LocalFileSummary = {
  fileId: 'file-picture',
  path: targetPath,
  kind: 'attachment',
  deleted: false,
  updatedAt: '2026-10-03T10:00:00.000Z',
  acceptedHeadRevisionId: 'revision-picture',
  localHeadRevisionId: null,
  localOnly: false,
};

/** A reader over a fake file list and a fake load. */
function reader(
  files: () => readonly LocalFileSummary[],
  fails: () => boolean,
) {
  const loads: string[] = [];
  const owned = new Map<string, OwnedUrl>();
  let changes = 0;
  const read = createAttachmentReader({
    listFiles: () => Promise.resolve(files()),
    load: (revisionId) => {
      loads.push(revisionId);
      return fails()
        ? Promise.reject(new Error('Failed to fetch'))
        : Promise.resolve({ url: `blob:${revisionId}`, dispose: () => {} });
    },
    recent: new Map(),
    owned,
    changed: () => {
      changes += 1;
    },
  });
  return { read, loads, owned, changes: () => changes };
}

await test('a picture whose file arrives later loads on the next read of the same text', async () => {
  // The read marked a text done before its pictures loaded, so a picture
  // whose file was not on this device yet stayed out until its reference
  // changed.
  assert.notEqual(targetPath, '');
  let files: readonly LocalFileSummary[] = [];
  const subject = reader(
    () => files,
    () => false,
  );
  await subject.read.read(text, notePath);
  assert.equal(subject.read.complete(), false);
  assert.deepEqual(subject.loads, []);
  files = [pictureFile];
  await subject.read.read(text, notePath);
  assert.equal(subject.read.complete(), true);
  assert.deepEqual(subject.loads, ['revision-picture']);
  assert.equal(subject.owned.get(targetPath)?.url, 'blob:revision-picture');
  assert.equal(subject.changes(), 1);
  // A complete text reads nothing again.
  await subject.read.read(text, notePath);
  assert.deepEqual(subject.loads, ['revision-picture']);
});

await test('a picture whose bytes did not arrive loads on the next read', async () => {
  let fail = true;
  const subject = reader(
    () => [pictureFile],
    () => fail,
  );
  await subject.read.read(text, notePath);
  assert.equal(subject.read.complete(), false);
  assert.equal(subject.owned.size, 0);
  fail = false;
  await subject.read.read(text, notePath);
  assert.equal(subject.read.complete(), true);
  assert.deepEqual(subject.loads, ['revision-picture', 'revision-picture']);
});

await test('a reference that leaves the note frees its URL', async () => {
  let disposed = 0;
  const owned = new Map<string, OwnedUrl>();
  const subject = createAttachmentReader({
    listFiles: () => Promise.resolve([pictureFile]),
    load: () =>
      Promise.resolve({
        url: 'blob:one',
        dispose: () => {
          disposed += 1;
        },
      }),
    recent: new Map(),
    owned,
    changed: () => {},
  });
  await subject.read(text, notePath);
  assert.equal(owned.size, 1);
  await subject.read('no picture now\n', notePath);
  assert.equal(owned.size, 0);
  assert.equal(disposed, 1);
});

await test('a read parses the note only when its reference lines change', async () => {
  // The read parsed the whole note after each pause in typing, which took
  // over a second on a note of 500 KB at four times less CPU.
  let parses = 0;
  const subject = createAttachmentReader({
    listFiles: () => Promise.resolve([pictureFile]),
    load: () => Promise.resolve({ url: 'blob:one', dispose: () => {} }),
    recent: new Map(),
    owned: new Map(),
    changed: () => {},
    extract: (source, path) => {
      parses += 1;
      return extractAttachmentRefs(source, path);
    },
  });
  const long = `${'A line of words.\n'.repeat(1000)}${text}`;
  await subject.read(long, notePath);
  assert.equal(parses, 1);
  // Keys in the text, away from the picture, parse nothing.
  await subject.read(`typed ${long}`, notePath);
  await subject.read(`typed more ${long}`, notePath);
  assert.equal(parses, 1);
  // A key on the line of the picture, or a fence, parses again.
  await subject.read(`${long}![b](attachments/other.png)\n`, notePath);
  assert.equal(parses, 2);
  await subject.read(`\`\`\`\n${long}`, notePath);
  assert.equal(parses, 3);
  // A note with no picture parses nothing at all.
  await subject.read('A line of words.\n'.repeat(1000), notePath);
  assert.equal(parses, 3);
});
