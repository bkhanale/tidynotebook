import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapRelativeReferences,
  migrateLegacyReferences,
  rewriteRelativeReferences,
} from './rewrite.ts';

await test('a move rewrites inbound links and links inside the moved note', () => {
  const moved = new Map([
    ['folder/a.md', 'archive/a.md'],
    ['folder/b.md', 'folder/deep/b.md'],
  ]);
  const rewritten = rewriteRelativeReferences(
    '[A](a.md) and ![map](../attachments/map.png)',
    'folder/b.md',
    moved,
  );
  assert.equal(
    rewritten.text,
    '[A](../../archive/a.md) and ![map](../../attachments/map.png)',
  );
  assert.equal(rewritten.count, 2);
});

await test('legacy references migrate and dead references are reported', () => {
  const migrated = migrateLegacyReferences(
    '[A](/notes/3f2504e0-4f89-41d3-9a0c-0305e82c3301) ![x](/attachments/0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d) [dead](/notes/7c9e6679-7425-40de-944b-e07fc1f90ae7)',
    'folder/current.md',
    {
      notes: new Map([['3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'plan.md']]),
      attachments: new Map([
        ['0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d', 'attachments/image.png'],
      ]),
    },
  );
  assert.equal(
    migrated.text,
    '[A](../plan.md) ![x](../attachments/image.png) [dead](/notes/7c9e6679-7425-40de-944b-e07fc1f90ae7)',
  );
  assert.deepEqual(migrated.deadReferences, [
    '/notes/7c9e6679-7425-40de-944b-e07fc1f90ae7',
  ]);
});

await test('a map rewrites each relative destination and keeps the rest', () => {
  const seen: string[] = [];
  const mapped = mapRelativeReferences(
    [
      '[Start](start.md#first-note) and [Rules](../../SECURITY.md)',
      '[Site](https://example.com/a.md), [Here](#top) and [Kept](kept.md)',
      '',
      '[ref]: other.md',
    ].join('\n'),
    'docs/guide/README.md',
    (path, fragment) => {
      seen.push(`${path}${fragment}`);
      return path.endsWith('kept.md') ? null : `/site/${path}${fragment}`;
    },
  );
  assert.deepEqual(seen, [
    'docs/guide/start.md#first-note',
    'SECURITY.md',
    'docs/guide/kept.md',
    'docs/guide/other.md',
  ]);
  assert.equal(
    mapped.text,
    [
      '[Start](/site/docs/guide/start.md#first-note) and [Rules](/site/SECURITY.md)',
      '[Site](https://example.com/a.md), [Here](#top) and [Kept](kept.md)',
      '',
      '[ref]: /site/docs/guide/other.md',
    ].join('\n'),
  );
  assert.equal(mapped.count, 3);
});
