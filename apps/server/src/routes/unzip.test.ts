import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  maxArchiveEntries,
  maxArchiveExpandedBytes,
  maxFilesPerChangeset,
} from '@notesapp/core';
import { ArchiveRefusedError } from '../plugins/problem.ts';
import { zipArchive } from './zip.ts';
import { unzipArchive } from './unzip.ts';

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream)
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
  return Buffer.concat(parts);
}

/** The kind of the refusal that one read throws, or `none`. */
function refusalOf(archive: Buffer): string {
  try {
    unzipArchive(archive);
  } catch (error) {
    if (error instanceof ArchiveRefusedError) return error.refusal;
    throw error;
  }
  return 'none';
}

/** One archive of a single deflated entry that states the given size. */
function deflatedArchive(content: Buffer, statedSize: number): Buffer {
  const name = Buffer.from('notes/big.md');
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x0403_4b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(statedSize, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x0201_4b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(statedSize, 24);
  central.writeUInt16LE(name.length, 28);
  const body = Buffer.concat([local, name, compressed]);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

/** The ZIP64 records of an archive that states `count` files. */
function zip64Archive(count: number): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x0606_4b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x0706_4b50, 0);
  locator.writeBigUInt64LE(0n, 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffff_ffff, 12);
  end.writeUInt32LE(0xffff_ffff, 16);
  return Buffer.concat([record, locator, end]);
}

await test('an exported tree imports with the same paths and bytes', async () => {
  async function* entries() {
    yield {
      path: 'folder/note.md',
      bytes: Buffer.from('[x](../x.md)'),
      modified: new Date(0),
    };
    yield {
      path: 'attachments/pixel.png',
      bytes: Buffer.from([1, 2, 3]),
      modified: new Date(0),
    };
  }
  const archive = await readStream(zipArchive(entries()));
  assert.deepEqual(
    unzipArchive(archive).map((entry) => [entry.path, [...entry.bytes]]),
    [
      ['folder/note.md', [...Buffer.from('[x](../x.md)')]],
      ['attachments/pixel.png', [1, 2, 3]],
    ],
  );
});

await test('an archive path cannot leave the workspace tree', async () => {
  async function* entries() {
    yield {
      path: '../outside.md',
      bytes: Buffer.from('bad'),
      modified: new Date(0),
    };
  }
  const archive = await readStream(zipArchive(entries()));
  assert.equal(refusalOf(archive), 'archive_invalid');
});

await test('an export of more than 1000 files imports whole', async () => {
  // Issue 243. The reader refused more than 1000 entries, and the writer
  // writes up to the bound of the format.
  const count = maxFilesPerChangeset + 500;
  async function* entries() {
    for (let index = 0; index < count; index += 1)
      yield {
        path: `notes/${String(index)}.md`,
        bytes: Buffer.from(`# ${String(index)}\n`),
        modified: new Date(0),
      };
  }
  const read = unzipArchive(await readStream(zipArchive(entries())));
  assert.equal(read.length, count);
  assert.equal(read.at(-1)?.path, `notes/${String(count - 1)}.md`);
});

await test('an archive past the bound names its count as the cause', () => {
  assert.equal(
    refusalOf(zip64Archive(maxArchiveEntries + 1)),
    'archive_too_many_files',
  );
  // A ZIP64 archive inside the bound is still a format that is not read.
  assert.equal(refusalOf(zip64Archive(10)), 'archive_invalid');
});

await test('an entry that expands past its stated size is refused as it expands', () => {
  const content = Buffer.alloc(4 * 1024 * 1024, 0x61);
  assert.equal(refusalOf(deflatedArchive(content, 16)), 'archive_invalid');
  assert.deepEqual(
    unzipArchive(deflatedArchive(content, content.length)).map(
      (entry) => entry.bytes.length,
    ),
    [content.length],
  );
});

await test('stated sizes past the bound are refused before any entry expands', () => {
  assert.equal(
    refusalOf(
      deflatedArchive(Buffer.from('small'), maxArchiveExpandedBytes + 1),
    ),
    'archive_too_large',
  );
});

await test('a file that is not a zip archive is named as one', () => {
  assert.equal(
    refusalOf(Buffer.from('plain text, not an archive at all')),
    'archive_invalid',
  );
  assert.equal(refusalOf(Buffer.alloc(4)), 'archive_invalid');
});
