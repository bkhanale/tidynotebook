import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { root } from './workspace.mjs';

await test('the folder dialogs are stored as reviewable text', async () => {
  const source = await readFile(
    resolve(root, 'apps/web/src/features/folders/folders.tsx'),
  );
  assert.equal(source.includes(0), false);
});
