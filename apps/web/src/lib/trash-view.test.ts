/** The visible Trash list is stable while a server change reaches the store. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTrash } from './trash-view.ts';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';

await test('the server statement wins over the local tombstone', () => {
  const items = mergeTrash(
    [
      {
        fileId: first,
        path: 'server-name.md',
        deletedAt: '2026-09-19T09:00:00.000Z',
      },
    ],
    [
      {
        fileId: first,
        path: 'local-name.md',
        deleted: true,
        updatedAt: '2026-09-19T08:00:00.000Z',
      },
      {
        fileId: second,
        path: 'local-only.md',
        deleted: true,
        updatedAt: '2026-09-19T10:00:00.000Z',
      },
    ],
  );

  assert.deepEqual(items, [
    {
      fileId: second,
      path: 'local-only.md',
      deletedAt: '2026-09-19T10:00:00.000Z',
      pending: true,
    },
    {
      fileId: first,
      path: 'server-name.md',
      deletedAt: '2026-09-19T09:00:00.000Z',
      pending: false,
    },
  ]);
});

await test('a removed note stays out while both sources still hold it', () => {
  const items = mergeTrash(
    [
      {
        fileId: first,
        path: 'gone.md',
        deletedAt: '2026-09-19T09:00:00.000Z',
      },
    ],
    [
      {
        fileId: first,
        path: 'gone.md',
        deleted: true,
        updatedAt: '2026-09-19T09:00:00.000Z',
      },
    ],
    new Set([first]),
  );

  assert.deepEqual(items, []);
});
