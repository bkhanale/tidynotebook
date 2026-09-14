import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { zipArchive } from './zip.ts';
import { unzipArchive } from './unzip.ts';

async function read(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream)
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
  return Buffer.concat(parts);
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
  const archive = await read(zipArchive(entries()));
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
  const archive = await read(zipArchive(entries()));
  assert.throws(() => unzipArchive(archive), /invalid path/);
});
