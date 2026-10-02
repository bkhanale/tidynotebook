import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  maxArchiveBytes,
  maxArchiveEntries,
  maxFilesPerChangeset,
} from '@notesapp/core';
import { ArchiveRefusedError } from '../plugins/problem.ts';
import { zipArchive } from './zip.ts';
import {
  bufferSource,
  readArchiveDirectory,
  readArchiveEntry,
  unzipArchive,
} from './unzip.ts';

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream)
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
  return Buffer.concat(parts);
}

/** The kind of the refusal that one read throws, or `none`. */
async function refusalOf(archive: Buffer): Promise<string> {
  try {
    await unzipArchive(archive);
  } catch (error) {
    if (error instanceof ArchiveRefusedError) return error.refusal;
    throw error;
  }
  return 'none';
}

/** One deflated entry of a hand built archive, with the size it states. */
type Deflated = {
  readonly path: string;
  readonly content: Buffer;
  readonly statedSize: number;
};

/** An archive of deflated entries that state the given sizes. */
function deflatedArchive(entries: readonly Deflated[]): Buffer {
  const bodies: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const compressed = deflateRawSync(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.statedSize, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x0201_4b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.statedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    const body = Buffer.concat([local, name, compressed]);
    bodies.push(body);
    directory.push(Buffer.concat([central, name]));
    offset += body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, central, end]);
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
    (await unzipArchive(archive)).map((entry) => [
      entry.path,
      [...entry.bytes],
    ]),
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
  assert.equal(await refusalOf(archive), 'archive_invalid');
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
  const read = await unzipArchive(await readStream(zipArchive(entries())));
  assert.equal(read.length, count);
  assert.equal(read.at(-1)?.path, `notes/${String(count - 1)}.md`);
});

await test('the directory is read and checked before any entry expands', async () => {
  // The import checks every path and size of an archive in a file before it
  // writes one file of it, and expands one entry at a time.
  const content = Buffer.from('# One\n');
  const archive = deflatedArchive([
    { path: 'a/one.md', content, statedSize: content.length },
    { path: 'a/two.md', content, statedSize: content.length },
  ]);
  const source = bufferSource(archive);
  const entries = await readArchiveDirectory(source);
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.size]),
    [
      ['a/one.md', content.length],
      ['a/two.md', content.length],
    ],
  );
  const second = entries[1];
  assert.ok(second !== undefined);
  assert.deepEqual(await readArchiveEntry(source, second), content);
});

await test('an archive past the bound names its count as the cause', async () => {
  assert.equal(
    await refusalOf(zip64Archive(maxArchiveEntries + 1)),
    'archive_too_many_files',
  );
  // A ZIP64 archive inside the bound is still a format that is not read.
  assert.equal(await refusalOf(zip64Archive(10)), 'archive_invalid');
});

await test('an entry that expands past its stated size is refused as it expands', async () => {
  const content = Buffer.alloc(4 * 1024 * 1024, 0x61);
  assert.equal(
    await refusalOf(
      deflatedArchive([{ path: 'notes/big.md', content, statedSize: 16 }]),
    ),
    'archive_invalid',
  );
  assert.deepEqual(
    (
      await unzipArchive(
        deflatedArchive([
          { path: 'notes/big.md', content, statedSize: content.length },
        ]),
      )
    ).map((entry) => entry.bytes.length),
    [content.length],
  );
});

await test('stated sizes past the bound are refused before any entry expands', async () => {
  const content = Buffer.from('small');
  const half = Math.ceil(maxArchiveBytes / 2) + 1;
  assert.equal(
    await refusalOf(
      deflatedArchive([
        { path: 'a.md', content, statedSize: half },
        { path: 'b.md', content, statedSize: half },
      ]),
    ),
    'archive_too_large',
  );
});

await test('a file that is not a zip archive is named as one', async () => {
  assert.equal(
    await refusalOf(Buffer.from('plain text, not an archive at all')),
    'archive_invalid',
  );
  assert.equal(await refusalOf(Buffer.alloc(4)), 'archive_invalid');
});
