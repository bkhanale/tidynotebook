import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { zipArchive, type ZipEntry } from './zip.ts';

/** Turns a list of entries into the archive bytes. */
async function archive(entries: readonly ZipEntry[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of zipArchive(
    (async function* stream() {
      for (const entry of entries) yield entry;
    })(),
  ))
    parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

/** One entry as a reader finds it through the central directory. */
type ReadEntry = { readonly path: string; readonly bytes: Buffer };

/**
 * Reads an archive the way a reader does: from the end record, through the
 * central directory, then to each local header.
 */
function readArchive(bytes: Buffer): readonly ReadEntry[] {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, 'the archive has no end record');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries: ReadEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(at), 0x0201_4b50);
    const checksum = bytes.readUInt32LE(at + 16);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42);
    const path = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(bytes.readUInt32LE(offset), 0x0403_4b50);
    const localName = bytes.readUInt16LE(offset + 26);
    const localExtra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const content = bytes.subarray(start, start + size);
    assert.equal(crc32(content), checksum, `the checksum of ${path} is wrong`);
    entries.push({ path, bytes: content });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const modified = new Date('2026-09-07T10:04:06.000Z');

await test('the archive holds every entry with its path and its bytes', async () => {
  const bytes = await archive([
    {
      path: 'notes/first.md',
      bytes: Buffer.from('# First\n', 'utf8'),
      modified,
    },
    { path: 'second.md', bytes: Buffer.from('body', 'utf8'), modified },
  ]);
  const entries = readArchive(bytes);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ['notes/first.md', 'second.md'],
  );
  assert.equal(entries[0]?.bytes.toString('utf8'), '# First\n');
  assert.equal(entries[1]?.bytes.toString('utf8'), 'body');
});

await test('an entry name and its content keep every UTF-8 character', async () => {
  const text = 'Grüße, 日本語, emoji 🎉\n';
  const bytes = await archive([
    {
      path: 'folder/Grüße 日本語.md',
      bytes: Buffer.from(text, 'utf8'),
      modified,
    },
  ]);
  const entries = readArchive(bytes);
  assert.equal(entries[0]?.path, 'folder/Grüße 日本語.md');
  assert.equal(entries[0]?.bytes.toString('utf8'), text);
  // Bit 11 states that the name is UTF-8, so a reader does not guess.
  assert.equal((bytes.readUInt16LE(6) & 0x0800) !== 0, true);
});

await test('an empty archive is still a readable archive', async () => {
  const bytes = await archive([]);
  assert.deepEqual(readArchive(bytes), []);
});

await test('the recorded time comes from the entry', async () => {
  const bytes = await archive([
    { path: 'a.md', bytes: Buffer.from('a', 'utf8'), modified },
  ]);
  const time = bytes.readUInt16LE(10);
  const date = bytes.readUInt16LE(12);
  assert.equal((date >> 9) + 1980, 2026);
  assert.equal((date >> 5) & 0x0f, 9);
  assert.equal(date & 0x1f, 7);
  assert.equal(time >> 11, 10);
  assert.equal((time >> 5) & 0x3f, 4);
});
