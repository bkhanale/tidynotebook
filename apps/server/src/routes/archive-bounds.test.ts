/** Checks the bounds of one import and one export before any byte (record 0170). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maxArchiveBytes,
  maxArchiveEntries,
  maxArchiveNameBytes,
} from '@notesapp/core';
import { ExportTooLargeError } from '../plugins/problem.ts';
import { exportRefusal } from './export.ts';
import { archiveDiskReserveBytes, bodyRoomRefusal } from './import.ts';
import { archiveLength, zipArchive } from './zip.ts';

const gib = 1024 * 1024 * 1024;

await test('a body longer than its bound is refused from its length', () => {
  assert.equal(
    bodyRoomRefusal(maxArchiveBytes + 1, maxArchiveBytes, 100 * gib, 0),
    'too_large',
  );
});

await test('a body that the volume cannot hold with the reserve is refused', () => {
  // Review of issue 243. Nothing bounded the disk that an import used.
  const body = 2 * gib;
  assert.equal(
    bodyRoomRefusal(
      body,
      maxArchiveBytes,
      body + archiveDiskReserveBytes - 1,
      0,
    ),
    'no_room',
  );
  assert.equal(
    bodyRoomRefusal(body, maxArchiveBytes, body + archiveDiskReserveBytes, 0),
    null,
  );
  // A body with no length could be as long as the bound.
  assert.equal(bodyRoomRefusal(null, maxArchiveBytes, 3 * gib, 0), 'no_room');
  assert.equal(
    bodyRoomRefusal(
      null,
      maxArchiveBytes,
      maxArchiveBytes + archiveDiskReserveBytes,
      0,
    ),
    null,
  );
});

await test('a body that the room of the other running imports leaves is refused', () => {
  // Review of record 0170. Two imports that started together both saw the
  // whole free space, so together they could fill the volume.
  const body = 2 * gib;
  const free = 2 * body + archiveDiskReserveBytes;
  // Alone, the body fits with room for one more of its size.
  assert.equal(bodyRoomRefusal(body, maxArchiveBytes, free, 0), null);
  // Another import that may still write a body of the same size fits too.
  assert.equal(bodyRoomRefusal(body, maxArchiveBytes, free, body), null);
  // One byte more for the other import leaves no room for this one.
  assert.equal(
    bodyRoomRefusal(body, maxArchiveBytes, free, body + 1),
    'no_room',
  );
  // A body with no length counts the bound beside the other import.
  assert.equal(
    bodyRoomRefusal(
      null,
      maxArchiveBytes,
      maxArchiveBytes + archiveDiskReserveBytes + body - 1,
      body,
    ),
    'no_room',
  );
});

await test('an export past the count of the format is refused before its first byte', () => {
  // Review of issue 243. The export wrote up to 4 GiB before it refused.
  const plan = Array.from({ length: maxArchiveEntries + 1 }, (_, index) => ({
    path: `n/${String(index)}.md`,
    size: 0,
  }));
  const refusal = exportRefusal(plan);
  assert.ok(refusal instanceof ExportTooLargeError);
  assert.match(refusal.message, /65534 files at the most/);
  assert.equal(exportRefusal(plan.slice(0, maxArchiveEntries)), null);
});

await test('an export whose names pass the bound of an import is refused before its first byte', () => {
  // An import keeps the names of an archive together under one bound, so an
  // export writes no archive whose names an import would refuse.
  const longest = maxArchiveNameBytes / maxArchiveEntries;
  const path = (index: number, bytes: number): string => {
    const head = `${String(index).padStart(5, '0')}/`;
    return `${head}${'n'.repeat(bytes - head.length - '.md'.length)}.md`;
  };
  const plan = Array.from({ length: maxArchiveEntries }, (_, index) => ({
    path: path(index, longest),
    size: 0,
  }));
  assert.equal(exportRefusal(plan), null);
  const refusal = exportRefusal([
    ...plan.slice(1),
    { path: path(0, longest + 1), size: 0 },
  ]);
  assert.ok(refusal instanceof ExportTooLargeError);
  assert.match(refusal.message, /names of the notes and folders/);
});

await test('an export past the bytes of the format is refused before its first byte', () => {
  const plan = [
    { path: 'a.png', size: 3 * gib },
    { path: 'b.png', size: 2 * gib },
  ];
  assert.ok(exportRefusal(plan) instanceof ExportTooLargeError);
});

await test('the planned length is the length of the written archive', async () => {
  const entries = [
    { path: 'a.md', bytes: Buffer.from('# A\n'), modified: new Date(0) },
    { path: 'folder/Grüße.md', bytes: Buffer.from('ü'), modified: new Date(0) },
    {
      path: 'attachments/x.png',
      bytes: Buffer.alloc(1000),
      modified: new Date(0),
    },
  ];
  const parts: Buffer[] = [];
  for await (const chunk of zipArchive(
    (async function* stream() {
      for (const entry of entries) yield entry;
    })(),
  ))
    if (Buffer.isBuffer(chunk)) parts.push(chunk);
  assert.equal(
    Buffer.concat(parts).length,
    archiveLength(
      entries.map((entry) => ({ path: entry.path, size: entry.bytes.length })),
    ),
  );
});
